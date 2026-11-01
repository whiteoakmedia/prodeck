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
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key unless a release keystore is set up
            // (sideloaded installs don't need a store key).
            signingConfig = signingConfigs.getByName("debug")
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
