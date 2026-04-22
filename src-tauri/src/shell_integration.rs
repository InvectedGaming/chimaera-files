//! Windows shell integration.
//!
//! Installs a per-user registry entry ("Open in Chimaera") under the three
//! relevant HKCU\Software\Classes keys:
//!   - `Directory\shell\OpenInChimaera`              — right-click a folder
//!   - `Drive\shell\OpenInChimaera`                   — right-click a drive
//!   - `Directory\Background\shell\OpenInChimaera`   — right-click empty
//!                                                     space inside a folder
//!
//! Per-user (HKCU) keys don't require admin. On Windows 11 the entry lives
//! under "Show more options" until we ship a packaged `IExplorerCommand`
//! shell extension — that's a future PR.

#![cfg(windows)]

use std::io;

const VERB_NAME: &str = "OpenInChimaera";
const DISPLAY_NAME: &str = "Open in Chimaera";

/// Paths (under HKCU\Software\Classes) where we register the verb.
const TARGETS: &[(&str, &str)] = &[
    // (key path, param placeholder for the command line)
    ("Directory\\shell", "%1"),
    ("Drive\\shell", "%1"),
    // For empty-folder-background clicks, Explorer substitutes %V with the
    // folder path; %1 is the folder object and can resolve to strange things.
    ("Directory\\Background\\shell", "%V"),
];

pub fn install() -> io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = std::env::current_exe()?
        .to_string_lossy()
        .replace('/', "\\");
    let command = format!("\"{}\" \"%ARG%\"", exe);
    let icon = format!("\"{}\",0", exe);

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for (base, placeholder) in TARGETS {
        let verb_key = format!("Software\\Classes\\{}\\{}", base, VERB_NAME);
        let cmd_key = format!("{}\\command", verb_key);

        let (verb, _) = hkcu.create_subkey(&verb_key)?;
        verb.set_value("", &DISPLAY_NAME)?;
        verb.set_value("Icon", &icon)?;

        let (cmd, _) = hkcu.create_subkey(&cmd_key)?;
        let command_line = command.replace("%ARG%", placeholder);
        cmd.set_value("", &command_line)?;
    }
    Ok(())
}

pub fn uninstall() -> io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for (base, _) in TARGETS {
        let verb_key = format!("Software\\Classes\\{}\\{}", base, VERB_NAME);
        // delete_subkey_all removes the verb key + the nested \command key.
        // Ignore "not found" — uninstall should be idempotent.
        let _ = hkcu.delete_subkey_all(&verb_key);
    }
    Ok(())
}

pub fn is_installed() -> bool {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    TARGETS.iter().all(|(base, _)| {
        let verb_key = format!("Software\\Classes\\{}\\{}\\command", base, VERB_NAME);
        hkcu.open_subkey(&verb_key).is_ok()
    })
}
