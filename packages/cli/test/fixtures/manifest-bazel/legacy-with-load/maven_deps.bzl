load("@rules_jvm_external//:defs.bzl", "maven_install")

def load_maven_deps():
    maven_install(
        name = "maven_legacy_app",
        artifacts = [
            "com.google.guava:guava:33.0.0-jre",
            "junit:junit:4.13.2",
        ],
        repositories = ["https://repo1.maven.org/maven2"],
    )
