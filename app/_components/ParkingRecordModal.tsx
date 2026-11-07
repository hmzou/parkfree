import React, { useState } from 'react';
import { Modal, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../_i18n';
import { ParkingSession } from '../_types';
import { recordLines, recordText } from '../_services/parkingRecord';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/**
 * Share on phones; on the web, use the browser's share sheet when there is one,
 * otherwise open a printable page (which can be saved as PDF).
 */
async function shareRecord(session: ParkingSession): Promise<'shared' | 'printed' | 'failed'> {
  const text = recordText(session);
  if (Platform.OS !== 'web') {
    await Share.share({ title: t('record.title'), message: text });
    return 'shared';
  }
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.share) {
    try {
      await nav.share({ title: t('record.title'), text });
      return 'shared';
    } catch {
      // Cancelled or not allowed: fall through to the printable page
    }
  }
  const win = globalThis.open?.('', '_blank');
  if (!win) return 'failed';
  win.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(t('record.title'))}</title>`
    + '<style>body{font:15px/1.5 -apple-system,Segoe UI,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem}'
    + 'pre{white-space:pre-wrap;font:inherit}</style></head><body>'
    + `<pre>${escapeHtml(text)}</pre></body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
  return 'printed';
}

interface Props {
  session: ParkingSession | null;
  onClose: () => void;
}

/** A session's parking record: what to show a by-law officer or attach to a dispute. */
export const ParkingRecordModal: React.FC<Props> = ({ session, onClose }) => {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<'idle' | 'failed'>('idle');
  if (!session) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <Ionicons name="document-text-outline" size={22} color="#00E676" />
            <Text style={styles.title}>{t('record.title')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={22} color="#AAA" />
            </TouchableOpacity>
          </View>
          <Text style={styles.intro}>{t('record.intro')}</Text>

          <ScrollView style={styles.body} contentContainerStyle={{ gap: 10 }}>
            {recordLines(session).map(line => (
              <View key={line.label}>
                <Text style={styles.label}>{line.label}</Text>
                <Text style={styles.value} selectable>{line.value}</Text>
              </View>
            ))}
            {!session.record && <Text style={styles.note}>{t('record.noSnapshot')}</Text>}
            <Text style={styles.note}>{t('record.integrity')}</Text>
            <Text style={styles.note}>{t('record.disclaimer')}</Text>
          </ScrollView>

          <TouchableOpacity
            style={styles.shareBtn}
            activeOpacity={0.85}
            onPress={async () => {
              const result = await shareRecord(session).catch(() => 'failed' as const);
              setStatus(result === 'failed' ? 'failed' : 'idle');
            }}
          >
            <Ionicons name="share-outline" size={18} color="#111" />
            <Text style={styles.shareText}>{t('record.share')}</Text>
          </TouchableOpacity>
          {status === 'failed' && <Text style={styles.failed}>{t('record.shareFailed')}</Text>}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '88%',
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '800',
    flex: 1,
  },
  intro: {
    color: '#AAA',
    fontSize: 13,
  },
  body: {
    flexGrow: 0,
  },
  label: {
    color: '#777',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  value: {
    color: '#EEE',
    fontSize: 15,
  },
  note: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  shareBtn: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00E676',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 4,
  },
  shareText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '700',
  },
  failed: {
    color: '#FF5252',
    fontSize: 13,
    textAlign: 'center',
  },
});
