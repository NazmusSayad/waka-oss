use std::{collections::HashMap, fs::File, io::BufReader};

use chrono::DateTime;
use chrono_tz::Tz;
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::{
    ingest::{Heartbeat, insert},
    rollups,
};

#[derive(Deserialize)]
struct Export {
    days: Vec<Day>,
}

#[derive(Deserialize)]
struct Day {
    heartbeats: Vec<ExportHeartbeat>,
}

#[derive(Deserialize)]
struct ExportHeartbeat {
    #[serde(flatten)]
    heartbeat: Heartbeat,
    user_agent_id: String,
    machine_name_id: String,
}

#[derive(Deserialize)]
struct Lookup {
    data: Vec<LookupEntry>,
}

#[derive(Deserialize)]
struct LookupEntry {
    id: String,
    value: String,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &str) -> T {
    let file = File::open(path).unwrap_or_else(|e| panic!("cannot open {path}: {e}"));
    serde_json::from_reader(BufReader::new(file)).unwrap_or_else(|e| panic!("cannot parse {path}: {e}"))
}

fn read_lookup(path: &str) -> HashMap<String, String> {
    read_json::<Lookup>(path)
        .data
        .into_iter()
        .map(|entry| (entry.id, entry.value))
        .collect()
}

pub async fn run(db: SqlitePool, tz: Tz, export_path: &str, user_agents_path: &str, machine_names_path: &str) {
    let user_agents = read_lookup(user_agents_path);
    let machines = read_lookup(machine_names_path);
    println!("reading {export_path}");
    let export: Export = read_json(export_path);
    let mut heartbeats: Vec<ExportHeartbeat> = export.days.into_iter().flat_map(|day| day.heartbeats).collect();
    if heartbeats.is_empty() {
        println!("the export has no heartbeats");
        return;
    }

    let missing_user_agents = heartbeats
        .iter()
        .filter(|row| !user_agents.contains_key(&row.user_agent_id))
        .count();
    let missing_machines = heartbeats
        .iter()
        .filter(|row| !machines.contains_key(&row.machine_name_id))
        .count();
    println!(
        "{missing_user_agents} heartbeats have an unknown user_agent_id and {missing_machines} an unknown \
         machine_name_id; their editor/os or machine are left empty"
    );

    for row in &mut heartbeats {
        row.heartbeat.user_agent = user_agents.get(&row.user_agent_id).cloned();
    }

    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM heartbeats")
        .fetch_one(&db)
        .await
        .expect("count heartbeats");
    for (index, chunk) in heartbeats.chunks(10_000).enumerate() {
        let mut tx = db.begin().await.expect("begin transaction");
        for row in chunk {
            let utc = DateTime::from_timestamp_micros((row.heartbeat.time * 1_000_000.0).round() as i64)
                .unwrap_or_else(|| panic!("invalid time {}", row.heartbeat.time));
            insert(&mut tx, &row.heartbeat, machines.get(&row.machine_name_id).map(String::as_str), utc.with_timezone(&tz))
                .await
                .expect("insert heartbeat");
        }
        tx.commit().await.expect("commit transaction");
        println!("{} / {}", (index * 10_000 + chunk.len()), heartbeats.len());
    }
    let times = heartbeats.iter().map(|row| row.heartbeat.time);
    let earliest = times.clone().fold(f64::INFINITY, f64::min);
    let latest = times.fold(f64::NEG_INFINITY, f64::max);
    let mut connection = db.acquire().await.expect("acquire connection");
    println!("building summaries");
    rollups::refresh(&mut connection, tz, earliest, latest)
        .await
        .expect("build summaries");
    drop(connection);

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM heartbeats")
        .fetch_one(&db)
        .await
        .expect("count heartbeats");
    println!("imported {} new heartbeats ({} already present or duplicates)", after - before, heartbeats.len() as i64 - (after - before));
}
