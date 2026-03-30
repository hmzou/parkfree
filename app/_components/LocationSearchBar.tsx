import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Text,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '../_contexts/LocaleContext';
import { t } from '../_i18n';
import { geocodeSuggestions, GeocodingResult } from '../_services/geocoding';

interface Props {
  onSelectResult: (result: GeocodingResult) => void;
}

export const LocationSearchBar: React.FC<Props> = ({ onSelectResult }) => {
  useLocale();

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const handleChangeText = useCallback((text: string) => {
    setQuery(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await geocodeSuggestions(text);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, []);

  const handleSelect = useCallback(
    (result: GeocodingResult) => {
      setQuery(result.shortName);
      setSuggestions([]);
      Keyboard.dismiss();
      onSelectResult(result);
    },
    [onSelectResult],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setSuggestions([]);
    inputRef.current?.focus();
  }, []);

  const showDropdown = focused && suggestions.length > 0;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.bar, focused && styles.barFocused]}>
        <Ionicons name="search" size={18} color="#AAA" style={styles.searchIcon} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={handleChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay so tapping a suggestion fires before blur clears the list
            setTimeout(() => setFocused(false), 200);
          }}
          placeholder={t('search.placeholder')}
          placeholderTextColor="#666"
          returnKeyType="search"
          clearButtonMode="never"
          autoCorrect={false}
          autoCapitalize="words"
        />
        {loading && (
          <ActivityIndicator size="small" color="#00C853" style={styles.loadingIndicator} />
        )}
        {!loading && query.length > 0 && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {showDropdown && (
        <View style={styles.dropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={(item, i) => `${item.latitude}_${item.longitude}_${i}`}
            keyboardShouldPersistTaps="always"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.suggestionRow}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={item.isBusiness ? 'business-outline' : 'location-outline'}
                  size={16}
                  color="#00C853"
                  style={styles.suggestionIcon}
                />
                <View style={styles.suggestionText}>
                  <Text style={styles.suggestionMain} numberOfLines={1}>
                    {item.shortName}
                  </Text>
                  <Text style={styles.suggestionSub} numberOfLines={1}>
                    {item.placeName}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,26,26,0.96)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  barFocused: {
    borderColor: 'rgba(0,200,83,0.5)',
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    padding: 0,
  },
  loadingIndicator: {
    marginLeft: 6,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    maxHeight: 260,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionIcon: {
    marginRight: 10,
  },
  suggestionText: {
    flex: 1,
  },
  suggestionMain: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionSub: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: '#222',
    marginHorizontal: 14,
  },
});
