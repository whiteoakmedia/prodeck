mod audio;
mod avantis;
mod chat;
mod checkin;
mod discovery;
mod edge;
mod identity;
mod ga4;
mod gemini;
mod midi;
mod ndi;
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

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokio::sync::Mutex as AsyncMutex;

/// Write a printable HTML document to a temp file and open it in the default
/// browser, where printing and save-as-PDF work reliably. The in-app WebView's
/// window.print() is unreliable on macOS, so the Report page hands its rendered
/// HTML here instead.
#[tauri::command]
fn open_print_html(html: String) -> Result<(), String> {
    let mut path = std::env::temp_dir();
    path.push("prodeck-report.html");
    std::fs::write(&path, html.as_bytes()).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// One-time migration from the legacy data-folder name. The app was renamed;
/// existing installs keep their data (and the settings paths pointing into it)
/// without anyone noticing. This is deliberately the only place in the
/// codebase where the old name appears.
fn migrate_legacy_data_dir() {
    let Some(base) = dirs::config_dir() else { return };
    let old = base.join("ProdLink");
    let new = base.join("ProDeck");
    if old.is_dir() && !new.exists() {
        if std::fs::rename(&old, &new).is_ok() {
            // Path-valued settings (e.g. the GA4 key path) point into the old
            // folder — rewrite them in place before anything loads.
            let sp = new.join("settings.json");
            if let Ok(txt) = std::fs::read_to_string(&sp) {
                let fixed = txt.replace("/ProdLink/", "/ProDeck/");
                if fixed != txt {
                    let _ = std::fs::write(&sp, fixed);
                }
            }
        }
    }
}

pub fn run() {
    migrate_legacy_data_dir();
    let loaded_settings = settings::load();
    // Capture web-gateway autostart config before the settings value is moved.
    let web_autostart = if loaded_settings.web_enabled && !loaded_settings.web_password.is_empty() {
        Some(loaded_settings.web_port)
    } else {
        None
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(AsyncMutex::new(None::<propresenter::ProPresenterConnection>))
            as propresenter::ProPresenterState)
        .manage(Arc::new(AsyncMutex::new(ndi::NdiManager::new())) as ndi::NdiState)
        .manage(Arc::new(AsyncMutex::new(relay::RelayManager::new())) as relay::RelayState)
        .manage(Mutex::new(loaded_settings) as settings::SettingsState)
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
            if let Some(port) = web_autostart {
                let state = app.state::<web::WebState>().inner().clone();
                web::start(app.handle().clone(), state, port);
            }
            tap::spawn_heartbeat(app.handle().clone());
            avantis::spawn_mirror(app.handle().clone());
            avantis::spawn_watch_flush(app.handle().clone());
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
            tap::tap_override,
            tap::tap_edge_state,
            tap::tap_mappings,
            tap::tap_save_mappings,
            tap::tap_stats,
            tap::tap_stats_range,
            tap::tap_check_links,
            tap::tap_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
