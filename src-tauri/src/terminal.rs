use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

pub type TerminalId = u32;

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct TerminalManager {
    sessions: HashMap<TerminalId, TerminalSession>,
    next_id: TerminalId,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
        }
    }

    pub fn spawn(
        &mut self,
        cwd: &str,
        shell: Option<&str>,
        on_output: Box<dyn Fn(TerminalId, Vec<u8>) + Send + 'static>,
    ) -> Result<TerminalId, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell_cmd = shell.unwrap_or("powershell.exe");
        let mut cmd = CommandBuilder::new(shell_cmd);
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let id = self.next_id;
        self.next_id += 1;

        // Spawn reader thread
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => on_output(id, buf[..n].to_vec()),
                    Err(_) => break,
                }
            }
        });

        self.sessions.insert(
            id,
            TerminalSession {
                writer,
                child,
            },
        );

        Ok(id)
    }

    pub fn write(&mut self, id: TerminalId, data: &[u8]) -> Result<(), String> {
        let session = self.sessions.get_mut(&id).ok_or("Terminal not found")?;
        session.writer.write_all(data).map_err(|e| e.to_string())
    }

    pub fn resize(&mut self, _id: TerminalId, _cols: u16, _rows: u16) -> Result<(), String> {
        // TODO: no-op — resize needs the MasterPty, which we currently drop
        // after `take_writer`. Storing it would let us call master.resize().
        Ok(())
    }

    pub fn close(&mut self, id: TerminalId) {
        if let Some(mut session) = self.sessions.remove(&id) {
            // Killing the child closes the slave PTY, which EOFs the reader
            // thread so it can exit instead of blocking on `read` forever.
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }
}

pub type SharedTerminalManager = Arc<Mutex<TerminalManager>>;
