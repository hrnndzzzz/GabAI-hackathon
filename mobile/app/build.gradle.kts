import java.util.Properties

plugins {
    id("com.android.application")
}

// Server settings come from local.properties (git-ignored) or environment variables, so the
// committed web bundle stays environment-agnostic. Leave them empty for a demo-only build.
val localProps = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun setting(key: String, env: String): String =
    (localProps.getProperty(key) ?: System.getenv(env) ?: "").replace("\\", "\\\\").replace("\"", "\\\"")

android {
    namespace = "com.example.gabai"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.gabai"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"

        buildConfigField("String", "API_BASE_URL", "\"${setting("gabai.apiBaseUrl", "GABAI_API_BASE_URL")}\"")
        buildConfigField("String", "SUPABASE_URL", "\"${setting("gabai.supabaseUrl", "GABAI_SUPABASE_URL")}\"")
        buildConfigField(
            "String",
            "SUPABASE_PUBLISHABLE_KEY",
            "\"${setting("gabai.supabasePublishableKey", "GABAI_SUPABASE_PUBLISHABLE_KEY")}\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    // Serves the bundled web app from https://appassets.androidplatform.net/assets/...
    implementation("androidx.webkit:webkit:1.17.1")
}
