mod ahmap;
mod audio;
mod avantis;
mod backup;
mod diag;
mod keepalive;
mod chat;
mod checkin;
mod discovery;
mod edge;
mod identity;
mod ga4;
mod gemini;
mod midi;
mod ndi;
mod obs;
mod osc;
mod pages;
mod posfiles;
mod pco;
mod push;
mod propresenter;
mod relay;
mod settings;
mod tap;
mod transcription;
mod web;
mod x32;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokio::sync::Mutex as AsyncMutex;

/// Write a printable HTML document to a temp file and open it in the default
/// browser, where printing and save-as-PDF work reliably. The in-app WebView's
/// window.print() is unreliable on macOS, so the Report page hands its rendered
/// HTML here instead.
#[tauri::command]
fn open_print_html(html: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut path = std::env::temp_dir();
    path.push("prodeck-report.html");
    std::fs::write(&path, html.as_bytes()).map_err(|e| e.to_string())?;
    // Was `Command::new("open")`, which exists only on macOS — printing a
    // report just raised an error toast anywhere else. The opener plugin picks
    // the right mechanism per platform and is already loaded.
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// One-time migration from the legacy data-folder name. The app was renamed;
/// existing installs keep their data (and the settings paths pointing into it)
/// without anyone noticing. This is deliberately the only place in the
/// codebase where the old name appears.
fn migrate_legacy_data_dir() {
    let Some(base) = dirs::config_dir() else { return };
    let old = base.join("ProdLink");
    let new = base.join("ProDeck");
    if !old.is_dir() {
        return;
    }
    // Already migrated (or a genuine new install that happens to sit next to
    // a stale legacy folder): never touch a ProDeck folder that has settings.
    if new.join("settings.json").exists() {
        return;
    }
    if !new.exists() {
        if let Err(e) = std::fs::rename(&old, &new) {
            crate::diag::log(format!("[migrate] could not rename {} -> {}: {e}", old.display(), new.display()));
            return;
        }
    } else {
        // ProDeck exists but holds no settings yet — e.g. only an ndi-lib/ or
        // models/ folder placed by hand. Move the legacy entries across one by
        // one, never overwriting, so nothing is stranded.
        let rd = match std::fs::read_dir(&old) {
            Ok(rd) => rd,
            Err(e) => {
                crate::diag::log(format!("[migrate] could not read {}: {e}", old.display()));
                return;
            }
        };
        for ent in rd.flatten() {
            let dst = new.join(ent.file_name());
            if dst.exists() {
                continue;
            }
            if let Err(e) = std::fs::rename(ent.path(), &dst) {
                crate::diag::log(format!("[migrate] could not move {}: {e}", ent.path().display()));
            }
        }
    }
    // Path-valued settings (e.g. the GA4 key path) point into the old folder.
    // Rewrite only string fields that are filesystem paths, and write
    // atomically — a torn settings.json is read back as defaults, which would
    // silently wipe passwords and tokens.
    let sp = new.join("settings.json");
    let Ok(txt) = std::fs::read_to_string(&sp) else { return };
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&txt) else { return };
    let mut changed = false;
    if let Some(obj) = v.as_object_mut() {
        for val in obj.values_mut() {
            if let Some(sv) = val.as_str() {
                if sv.starts_with('/') && sv.contains("/ProdLink/") {
                    *val = serde_json::Value::String(sv.replace("/ProdLink/", "/ProDeck/"));
                    changed = true;
                }
            }
        }
    }
    if !changed {
        return;
    }
    let Ok(out) = serde_json::to_string_pretty(&v) else { return };
    let tmp = sp.with_extension("json.tmp");
    let res = std::fs::write(&tmp, out).and_then(|_| std::fs::rename(&tmp, &sp));
    if let Err(e) = res {
        crate::diag::log(format!("[migrate] could not rewrite settings.json: {e}"));
        let _ = std::fs::remove_file(&tmp);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    migrate_legacy_data_dir();
    let loaded_settings = settings::load();
    // Capture web-gateway autostart config before the settings value is moved.
    let web_autostart = if loaded_settings.web_enabled && !loaded_settings.web_password.is_empty() {
        Some(loaded_settings.web_port)
    } else {
        None
    };

    let context = tauri::generate_context!();
    // The updater plugin fails initialization (a panic before any window) when
    // tauri.conf.json has no `plugins.updater` block. Adopters who don't
    // publish updates may drop the block, so only register it when present.
    let has_updater = context.config().plugins.0.contains_key("updater");
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init());
    if has_updater {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(AsyncMutex::new(None::<propresenter::ProPresenterConnection>))
            as propresenter::ProPresenterState)
        .manage(Arc::new(AsyncMutex::new(ndi::NdiManager::new())) as ndi::NdiState)
        .manage(Arc::new(AsyncMutex::new(relay::RelayManager::new())) as relay::RelayState)
        .manage(Mutex::new(loaded_settings) as settings::SettingsState)
        .manage(keepalive::KeepAwake(Mutex::new(None)))
        .manage(obs::new_state())
        .manage(Arc::new(audio::AudioInner::new()) as audio::AudioState)
        .manage(Arc::new(transcription::TranscriptionInner::new())
            as transcription::TranscriptionState)
        .manage(midi::MidiState::new())
        .manage(midi::MidiOutState::new())
        .manage(Arc::new(osc::OscInner::new()) as osc::OscState)
        .manage(Arc::new(pco::PcoInner::new()) as pco::PcoState)
        .manage(Arc::new(web::WebInner::new()) as web::WebState)
        .manage(Arc::new(AsyncMutex::new(tap::TapInner::new())) as tap::TapState)
        .manage(Arc::new(chat::ChatInner::new()) as chat::ChatState)
        .manage(Arc::new(pages::PagesInner::new()) as pages::PagesState)
        .manage(Arc::new(push::PushInner::load()) as push::PushState)
        .manage(Arc::new(checkin::CheckinInner::load()) as checkin::CheckinState)
        .manage(Arc::new(posfiles::PosFilesInner::load()) as posfiles::PosFilesState)
        .manage(Arc::new(identity::IdentityInner::load()) as identity::IdentityState)
        .manage(Arc::new(Mutex::new(avantis::AvantisInner::default())) as avantis::AvantisState)
        .manage(ga4::new_state())
        .setup(move |app| {
            // Sleep guard (Settings → Reliability), on by default: a booth Mac
            // that dozes off takes everything in the room down with it.
            {
                let on = app.state::<settings::SettingsState>().lock().unwrap_or_else(|p| p.into_inner()).keep_awake;
                if on {
                    keepalive::set_keep_awake(&app.handle().clone(), true);
                }
            }
            if let Some(port) = web_autostart {
                let state = app.state::<web::WebState>().inner().clone();
                web::start(app.handle().clone(), state, port);
            }
            tap::spawn_heartbeat(app.handle().clone());
            avantis::spawn_mirror(app.handle().clone());
            avantis::spawn_watch_flush(app.handle().clone());
            obs::spawn_client(app.handle().clone());
            x32::spawn_mirror(app.handle().clone());
            edge::spawn_edge_push(app.handle().clone());
            ga4::spawn_ga4_poll(app.handle().clone());
            propresenter::spawn_lobby_auto(app.handle().clone());
            propresenter::spawn_announcement_poll(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ProPresenter
            propresenter::pp_connect,
            propresenter::pp_disconnect,
            propresenter::pp_is_connected,
            propresenter::pp_get,
            propresenter::pp_put,
            propresenter::pp_delete,
            propresenter::pp_action,
            propresenter::pp_trigger_next,
            propresenter::pp_trigger_previous,
            propresenter::pp_clear_layer,
            propresenter::pp_trigger_macro,
            propresenter::pp_trigger_look,
            propresenter::pp_timer_op,
            propresenter::pp_set_stage_message,
            propresenter::pp_clear_stage_message,
            propresenter::pp_thumbnail,
            propresenter::pp_playlist_thumbnail,
            open_print_html,
            // Discovery
            discovery::discover_services,
            // NDI
            ndi::ndi_discover_sources,
            ndi::ndi_start_receiver,
            ndi::ndi_stop_receiver,
            // Relay
            relay::relay_start_host,
            relay::relay_broadcast,
            relay::relay_connect_client,
            relay::relay_stop,
            relay::get_relay_status,
            // Settings
            settings::get_settings,
            settings::update_settings,
            settings::load_dashboards,
            settings::save_dashboards,
            settings::load_pco_data,
            settings::save_pco_data,
            settings::load_tracking,
            settings::save_tracking,
            settings::load_reports,
            settings::save_reports,
            settings::load_schedules,
            settings::save_schedules,
            settings::load_checklists,
            settings::load_routing,
            settings::save_routing,
            settings::save_checklists,
            settings::checklist_toggle,
            // Planning Center
            pco::pco_get,
            pco::pco_attachment_open,
            pco::pco_chord_chart,
            pco::pco_test,
            pco::pco_start_sync,
            pco::pco_stop_sync,
            pco::pco_set_live_interval,
            pco::pco_live_action,
            pco::pco_live_controller,
            // Audio
            audio::list_audio_inputs,
            audio::default_audio_input,
            audio::audio_input_channels,
            audio::start_audio_capture,
            audio::stop_audio_capture,
            // Transcription
            transcription::transcription_status,
            transcription::inject_caption,
            transcription::start_transcription,
            transcription::stop_transcription,
            // Gemini smart matching
            gemini::gemini_pick_slide,
            gemini::gemini_test,
            // MIDI
            midi::list_midi_inputs,
            midi::connect_midi,
            midi::disconnect_midi,
            midi::list_midi_outputs,
            midi::connect_midi_out,
            midi::disconnect_midi_out,
            midi::midi_send_key,
            // OSC
            osc::start_osc,
            osc::stop_osc,
            osc::osc_send_key,
            // Web gateway (LAN browser access)
            web::web_start,
            web::crew_join_open,
            gemini::help_ask,
            identity::identity_set_perms,
            web::crew_join_state,
            web::web_stop,
            web::web_status,
            // TapLink (NFC destination sync). State/override/stats are also in
            // the web dispatch; mappings + link checks stay booth-only.
            // Team messaging
            chat::chat_send,
            chat::chat_history,
            chat::chat_clear_confidence,
            // Pages (priority channel + read receipts)
            pages::page_send,
            pages::page_ack,
            pages::page_rebuzz,
            pages::page_list,
            posfiles::posfile_list,
            posfiles::posfile_add,
            posfiles::posfile_remove,
            push::push_public_key,
            push::push_subscribe,
            push::push_unsubscribe,
            checkin::checkin_set,
            checkin::checkin_list,
            checkin::checkin_wan_ip,
            checkin::checkin_set_service,
            // Crew identity (booth-side management)
            identity::identity_list,
            identity::identity_roles,
            identity::invite_create,
            identity::invite_list,
            identity::invite_revoke,
            obs::obs_state,
            obs::obs_set_scene,
            avantis::avantis_state,
            ga4::ga4_state,
            avantis::avantis_set_mute,
            avantis::avantis_recall_scene,
            avantis::avantis_set_fader,
            avantis::avantis_set_name,
            identity::identity_approve,
            identity::identity_set_role,
            identity::identity_heal_pco,
            identity::identity_remove,
            identity::identity_update_profile,
            tap::tap_override,
            tap::tap_edge_state,
            tap::tap_mappings,
            tap::tap_save_mappings,
            tap::tap_stats,
            tap::tap_stats_range,
            tap::tap_check_links,
            tap::tap_test,
            diag::diag_bundle,
            diag::diag_open_issue,
            diag::diag_recent_log,
            diag::help_open,
            keepalive::keepalive_status,
            keepalive::keepalive_install,
            keepalive::keepalive_uninstall,
            keepalive::keepalive_relaunch,
            keepalive::keep_awake_set,
            backup::backup_export,
            backup::backup_import,
        ])
        .run(context)
        .expect("error while running tauri application");
}
