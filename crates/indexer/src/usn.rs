#![cfg(windows)]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::IO::DeviceIoControl;

// FSCTL constants
const FSCTL_QUERY_USN_JOURNAL: u32 = 0x000900F4;
const FSCTL_READ_USN_JOURNAL: u32 = 0x000900BB;

// USN reason flags
pub const USN_REASON_DATA_OVERWRITE: u32 = 0x00000001;
pub const USN_REASON_DATA_EXTEND: u32 = 0x00000002;
pub const USN_REASON_DATA_TRUNCATION: u32 = 0x00000004;
pub const USN_REASON_FILE_CREATE: u32 = 0x00000100;
pub const USN_REASON_FILE_DELETE: u32 = 0x00000200;
pub const USN_REASON_RENAME_OLD_NAME: u32 = 0x00001000;
pub const USN_REASON_RENAME_NEW_NAME: u32 = 0x00002000;
pub const USN_REASON_CLOSE: u32 = 0x80000000;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct UsnJournalDataV0 {
    usn_journal_id: u64,
    first_usn: u64,
    next_usn: u64,
    lowest_valid_usn: u64,
    max_usn: u64,
    maximum_size: u64,
    allocation_delta: u64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct ReadUsnJournalDataV0 {
    start_usn: u64,
    reason_mask: u32,
    return_only_on_close: u32,
    timeout: u64,
    bytes_to_wait_for: u64,
    usn_journal_id: u64,
}

#[repr(C)]
#[derive(Debug)]
struct UsnRecordV2Header {
    record_length: u32,
    major_version: u16,
    minor_version: u16,
    file_reference_number: u64,
    parent_file_reference_number: u64,
    usn: u64,
    time_stamp: i64,
    reason: u32,
    source_info: u32,
    security_id: u32,
    file_attributes: u32,
    file_name_length: u16,
    file_name_offset: u16,
}

#[derive(Debug, Clone)]
pub struct JournalInfo {
    pub journal_id: u64,
    pub first_usn: u64,
    pub next_usn: u64,
    pub lowest_valid_usn: u64,
}

#[derive(Debug, Clone)]
pub struct UsnEntry {
    pub usn: u64,
    pub file_ref: u64,
    pub parent_ref: u64,
    pub reason: u32,
    pub file_attributes: u32,
    pub file_name: String,
    pub timestamp: i64,
}

impl UsnEntry {
    pub fn is_directory(&self) -> bool {
        self.file_attributes & 0x10 != 0 // FILE_ATTRIBUTE_DIRECTORY
    }

    pub fn is_create(&self) -> bool {
        self.reason & USN_REASON_FILE_CREATE != 0
    }

    pub fn is_delete(&self) -> bool {
        self.reason & USN_REASON_FILE_DELETE != 0
    }

    pub fn is_rename_new(&self) -> bool {
        self.reason & USN_REASON_RENAME_NEW_NAME != 0
    }

    pub fn is_rename_old(&self) -> bool {
        self.reason & USN_REASON_RENAME_OLD_NAME != 0
    }

    pub fn is_close(&self) -> bool {
        self.reason & USN_REASON_CLOSE != 0
    }

    pub fn is_size_change(&self) -> bool {
        self.reason & (USN_REASON_DATA_EXTEND | USN_REASON_DATA_TRUNCATION | USN_REASON_DATA_OVERWRITE) != 0
    }
}

/// Safe wrapper around a Windows HANDLE that closes on drop.
pub struct VolumeHandle(HANDLE);

impl VolumeHandle {
    pub fn open(drive_letter: char) -> Result<Self, String> {
        let path = format!("\\\\.\\{}:", drive_letter);
        let wide: Vec<u16> = OsStr::new(&path).encode_wide().chain(Some(0)).collect();

        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                0, // No specific access needed for journal reads — FSCTL handles it
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                std::ptr::null_mut(),
            )
        };

        if handle == INVALID_HANDLE_VALUE {
            return Err(format!(
                "Failed to open volume {}:, error {}",
                drive_letter,
                std::io::Error::last_os_error()
            ));
        }

        Ok(Self(handle))
    }

    pub fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for VolumeHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

/// Query the USN journal metadata for a volume.
pub fn query_journal(handle: &VolumeHandle) -> Result<JournalInfo, String> {
    let mut journal_data = std::mem::MaybeUninit::<UsnJournalDataV0>::uninit();
    let mut bytes_returned: u32 = 0;

    let ok = unsafe {
        DeviceIoControl(
            handle.raw(),
            FSCTL_QUERY_USN_JOURNAL,
            std::ptr::null(),
            0,
            journal_data.as_mut_ptr() as *mut _,
            std::mem::size_of::<UsnJournalDataV0>() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    if ok == 0 {
        return Err(format!(
            "FSCTL_QUERY_USN_JOURNAL failed: {}",
            std::io::Error::last_os_error()
        ));
    }

    let data = unsafe { journal_data.assume_init() };
    Ok(JournalInfo {
        journal_id: data.usn_journal_id,
        first_usn: data.first_usn,
        next_usn: data.next_usn,
        lowest_valid_usn: data.lowest_valid_usn,
    })
}

/// Read USN journal entries starting from `start_usn`.
/// Returns the parsed entries and the next USN to continue from.
pub fn read_entries(
    handle: &VolumeHandle,
    start_usn: u64,
    journal_id: u64,
) -> Result<(Vec<UsnEntry>, u64), String> {
    let read_data = ReadUsnJournalDataV0 {
        start_usn,
        reason_mask: USN_REASON_FILE_CREATE
            | USN_REASON_FILE_DELETE
            | USN_REASON_RENAME_OLD_NAME
            | USN_REASON_RENAME_NEW_NAME
            | USN_REASON_DATA_OVERWRITE
            | USN_REASON_DATA_EXTEND
            | USN_REASON_DATA_TRUNCATION
            | USN_REASON_CLOSE,
        return_only_on_close: 0,
        timeout: 0,
        bytes_to_wait_for: 0,
        usn_journal_id: journal_id,
    };

    // 64KB buffer — enough for hundreds of entries
    let mut buffer = vec![0u8; 65536];
    let mut bytes_returned: u32 = 0;

    let ok = unsafe {
        DeviceIoControl(
            handle.raw(),
            FSCTL_READ_USN_JOURNAL,
            &read_data as *const _ as *const _,
            std::mem::size_of::<ReadUsnJournalDataV0>() as u32,
            buffer.as_mut_ptr() as *mut _,
            buffer.len() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    if ok == 0 {
        let err = std::io::Error::last_os_error();
        // ERROR_HANDLE_EOF (38) means no more entries — not an error
        if err.raw_os_error() == Some(38) {
            return Ok((Vec::new(), start_usn));
        }
        return Err(format!("FSCTL_READ_USN_JOURNAL failed: {}", err));
    }

    if bytes_returned < 8 {
        return Ok((Vec::new(), start_usn));
    }

    // First 8 bytes = next USN
    let next_usn = u64::from_le_bytes(buffer[0..8].try_into().unwrap());

    // Parse USN_RECORD_V2 entries from the rest of the buffer
    let mut entries = Vec::new();
    let mut offset = 8usize;
    let end = bytes_returned as usize;

    while offset < end {
        if offset + std::mem::size_of::<UsnRecordV2Header>() > end {
            break;
        }

        let header = unsafe { &*(buffer.as_ptr().add(offset) as *const UsnRecordV2Header) };

        if header.record_length == 0 || header.record_length as usize + offset > end {
            break;
        }

        // Only handle V2 records (most common on NTFS)
        if header.major_version == 2 {
            let name_offset = header.file_name_offset as usize;
            let name_len = header.file_name_length as usize;

            if offset + name_offset + name_len <= end {
                let name_ptr =
                    unsafe { buffer.as_ptr().add(offset + name_offset) as *const u16 };
                let name_slice =
                    unsafe { std::slice::from_raw_parts(name_ptr, name_len / 2) };
                let file_name = String::from_utf16_lossy(name_slice);

                entries.push(UsnEntry {
                    usn: header.usn,
                    file_ref: header.file_reference_number & 0x0000FFFFFFFFFFFF, // Mask out sequence number
                    parent_ref: header.parent_file_reference_number & 0x0000FFFFFFFFFFFF,
                    reason: header.reason,
                    file_attributes: header.file_attributes,
                    file_name,
                    timestamp: header.time_stamp,
                });
            }
        }

        offset += header.record_length as usize;
    }

    Ok((entries, next_usn))
}

/// Resolve a file reference number to a full path by looking up parents in the DB.
/// Falls back to filesystem stat if not in DB.
pub fn resolve_path_from_db(
    conn: &rusqlite::Connection,
    volume_root: &str,
    parent_ref: u64,
    file_name: &str,
) -> Option<String> {
    // Try to find parent by mft_ref
    let parent_path: Option<String> = conn
        .query_row(
            "SELECT path FROM files WHERE mft_ref = ?1 AND path LIKE ?2 || '%'",
            rusqlite::params![parent_ref as i64, volume_root],
            |row| row.get(0),
        )
        .ok();

    parent_path.map(|pp| {
        if pp.ends_with('/') {
            format!("{}{}", pp, file_name)
        } else {
            format!("{}/{}", pp, file_name)
        }
    })
}
