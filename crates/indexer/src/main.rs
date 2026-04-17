use chimaera_indexer::db;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let command = args.get(1).map(|s| s.as_str()).unwrap_or("index");

    match command {
        "index" => {
            let target = args
                .get(2)
                .map(PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().expect("failed to get cwd"));

            let db_path = args.get(3).map(PathBuf::from).unwrap_or_else(|| {
                dirs::data_local_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("chimaera-files")
                    .join("index.db")
            });

            println!("Chimaera Indexer v{}", env!("CARGO_PKG_VERSION"));
            println!("Target: {}", target.display());
            println!("Database: {}", db_path.display());
            println!();

            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent).expect("failed to create database directory");
            }

            let conn = db::open(&db_path).expect("failed to open database");

            let t0 = Instant::now();
            let stats = chimaera_indexer::walker::index_directory(&conn, &target)
                .expect("indexing failed");
            let walk_dur = t0.elapsed();

            println!("Walk + insert: {:.2?}", walk_dur);
            println!(
                "  {} files, {} directories",
                stats.files_inserted, stats.dirs_inserted
            );
            println!("  {} errors skipped", stats.errors);

            let t1 = Instant::now();
            chimaera_indexer::stats::compute_all(&conn).expect("folder stats failed");
            let stats_dur = t1.elapsed();
            println!("Folder stats:  {:.2?}", stats_dur);

            let t2 = Instant::now();
            chimaera_indexer::fts::populate(&conn).expect("FTS population failed");
            let fts_dur = t2.elapsed();
            println!("FTS index:     {:.2?}", fts_dur);

            let total_rows: i64 = conn
                .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))
                .unwrap_or(0);
            let db_size = std::fs::metadata(&db_path)
                .map(|m| m.len())
                .unwrap_or(0);

            println!();
            println!("Total rows: {}", total_rows);
            println!("DB size:    {:.2} MB", db_size as f64 / 1_048_576.0);
            println!("Total time: {:.2?}", t0.elapsed());
        }

        "search" => {
            let query = args.get(2).expect("usage: chimaera-indexer search <query>");
            let db_path = args.get(3).map(PathBuf::from).unwrap_or_else(|| {
                dirs::data_local_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("chimaera-files")
                    .join("index.db")
            });

            let conn = db::open_readonly(&db_path).expect("failed to open database");

            let t0 = Instant::now();
            let results =
                chimaera_indexer::fts::search(&conn, query, 25).expect("search failed");
            let dur = t0.elapsed();

            println!("Search: \"{}\" ({} results in {:.2?})", query, results.len(), dur);
            println!();
            for r in &results {
                let kind = if r.is_directory { "DIR " } else { "FILE" };
                let size = if r.is_directory {
                    String::new()
                } else {
                    format_size(r.size)
                };
                println!("  {} {} {}", kind, r.path, size);
            }
        }

        "stats" => {
            let path = args.get(2).expect("usage: chimaera-indexer stats <path>");
            let db_path = args.get(3).map(PathBuf::from).unwrap_or_else(|| {
                dirs::data_local_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("chimaera-files")
                    .join("index.db")
            });

            let conn = db::open_readonly(&db_path).expect("failed to open database");

            match chimaera_indexer::stats::get_folder_stats(&conn, path) {
                Ok(Some(s)) => {
                    println!("Folder: {}", path);
                    println!("  Total size:    {}", format_size(s.total_size));
                    println!("  Files:         {} ({} direct)", s.file_count, s.direct_file_count);
                    println!("  Subfolders:    {}", s.subfolder_count);
                    println!("  Max depth:     {}", s.deepest_file_depth);
                }
                Ok(None) => println!("No stats found for: {}", path),
                Err(e) => eprintln!("Error: {}", e),
            }
        }

        _ => {
            eprintln!("Usage: chimaera-indexer <command> [args]");
            eprintln!();
            eprintln!("Commands:");
            eprintln!("  index  [path] [db]   Index a directory tree");
            eprintln!("  search <query> [db]   Search the index");
            eprintln!("  stats  <path> [db]    Show folder statistics");
            std::process::exit(1);
        }
    }
}

fn format_size(bytes: i64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}
