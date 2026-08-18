import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { palette } from '@sm/client-core';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>Caisse — Snack Manager</Text>
      <Text style={styles.sub}>Socle prêt · noyau offline chargé</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: palette.text, fontSize: 26, fontWeight: '800' },
  sub: { color: palette.mut, fontSize: 15, marginTop: 8 },
});
