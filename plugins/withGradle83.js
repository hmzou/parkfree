// Custom config plugin: pins Gradle wrapper to 8.3 for Expo SDK 51 compatibility.
// Gradle 8.8 broke expo-module-gradle-plugin resolution and removed the
// `release` SoftwareComponent API used by expo-modules-core.
const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const GRADLE_VERSION = '8.3';
const DISTRIBUTION_URL = `https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-all.zip`;

module.exports = function withGradle83(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const wrapperPath = path.join(
        config.modRequest.platformProjectRoot,
        'gradle', 'wrapper', 'gradle-wrapper.properties'
      );
      if (fs.existsSync(wrapperPath)) {
        let content = fs.readFileSync(wrapperPath, 'utf8');
        content = content.replace(
          /^distributionUrl=.*/m,
          `distributionUrl=${DISTRIBUTION_URL}`
        );
        fs.writeFileSync(wrapperPath, content);
        console.log(`[withGradle83] Pinned Gradle wrapper to ${GRADLE_VERSION}`);
      }
      return config;
    },
  ]);
};
