// Adds settings for builds made on this machine to install over USB.
// SIBIMATE_LOCAL_DEVICE=1 lets the app talk plain HTTP to the API on this computer
// (reached through `adb reverse`). Store builds never set it, so they allow HTTPS only.
module.exports = ({ config }) => {
  if (process.env.SIBIMATE_LOCAL_DEVICE !== '1') {
    return config;
  }
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: true } }]],
  };
};
