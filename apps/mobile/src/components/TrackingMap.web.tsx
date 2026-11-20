import { colors, radius } from '@sibimate/ui-tokens';
import { createElement, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { type MapPoints, mapHtml } from '@/lib/map-html';

/** The browser build of the tracking map: the same page, in an iframe. */
export function TrackingMap({ pickup, helper }: MapPoints) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html] = useState(() => mapHtml({ pickup, helper }));

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ lat: helper.lat, lng: helper.lng }, '*');
  }, [helper.lat, helper.lng]);

  return (
    <View style={{ height: 220, borderRadius: radius[20], overflow: 'hidden', backgroundColor: colors.mapGround }}>
      {createElement('iframe', {
        ref: frame,
        srcDoc: html,
        title: 'Map',
        'aria-hidden': true,
        tabIndex: -1,
        style: { border: 0, width: '100%', height: '100%' },
      })}
    </View>
  );
}
