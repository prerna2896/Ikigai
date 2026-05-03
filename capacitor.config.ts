import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ikigai.app',
  appName: 'Ikigai',
  webDir: 'out',
  server: {
    androidScheme: 'https',
  },
  ios: {
    scrollEnabled: false,
    contentInset: 'automatic',
    backgroundColor: '#f6f5f2',
  },
};

export default config;
