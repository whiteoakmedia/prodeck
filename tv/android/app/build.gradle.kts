plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.prodeck.display"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.prodeck.display"
        // Fire TV Stick (2nd gen, Fire OS 5) and every Android TV box since.
        minSdk = 22
        targetSdk = 34
        // One number, shared with the booth (tv.rs reads the same file): a TV
        // below the booth's number is offered the update.
        versionCode = rootProject.file("VERSION").readText().trim().toInt()
        versionName = "1.$versionCode"
    }

    // A TV only accepts an update signed with the same key as the app it
    // has. That key lives outside the repo at ~/.prodeck/keys/
    // prodeck-display.keystore (a copy of the debug key the first releases
    // were signed with); without it, this Mac's debug key is used.
    val stable = file(System.getProperty("user.home") + "/.prodeck/keys/prodeck-display.keystore")
    signingConfigs {
        create("stable") {
            storeFile = stable
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (stable.exists()) signingConfigs.getByName("stable") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
