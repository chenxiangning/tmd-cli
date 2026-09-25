plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tmdcli.mobile"
    compileSdk = 35

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore/tmd-release.keystore")
            storePassword = "tmd-cli-mobile"
            keyAlias = "tmd"
            keyPassword = "tmd-cli-mobile"
        }
    }

    defaultConfig {
        applicationId = "com.tmdcli.mobile"
        minSdk = 29
        targetSdk = 35
        /* 发版注入:CI 从 tag 推导(release.yml);本地不传 = 0.0.0-dev */
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "0.0.0-dev"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            /* 自签 keystore(仓内 keystore/tmd-release.keystore,密码同文件注释):
             * 零成本侧载分发——签名跨版本稳定,升级覆盖安装不塌;非 Play 商店用途 */
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
