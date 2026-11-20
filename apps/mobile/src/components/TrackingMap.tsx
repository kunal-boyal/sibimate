import { colors, radius } from '@sibimate/ui-tokens';
import { type ComponentType, type RefObject, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView as NativeWebView } from 'react-native-webview';
import { type MapPoints, mapHtml } from '@/lib/map-html';

interface WebHandle {
  injectJavaScript(script: string): void;
}

// The library's own prop types do not resolve against this React Native version,
// so the few props used here are declared by hand.
const WebView = NativeWebView as unknown as ComponentType<{
  ref: RefObject<WebHandle | null>;
  source: { html: string };
  originWhitelist: string[];
  scrollEnabled: boolean;
  style: { flex: number };
}>;

/** A map of where the helper is and where they are going. The picture is described by the text beside it. */
export function TrackingMap({ pickup, helper }: MapPoints) {
  const web = useRef<WebHandle>(null);
  // The page is built once; later positions move the marker without reloading the map.
  const [html] = useState(() => mapHtml({ pickup, helper }));

  useEffect(() => {
    web.current?.injectJavaScript(`moveHelper(${helper.lat}, ${helper.lng}); true;`);
  }, [helper.lat, helper.lng]);

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ height: 220, borderRadius: radius[20], overflow: 'hidden', backgroundColor: colors.mapGround }}
    >
      <WebView ref={web} source={{ html }} originWhitelist={['*']} scrollEnabled={false} style={{ flex: 1 }} />
    </View>
  );
}
