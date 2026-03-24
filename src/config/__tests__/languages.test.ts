import { defaultLanguage, normalizeLanguageTag } from '@/config/languages'

describe('normalizeLanguageTag', () => {
  it('maps desktop simplified Chinese locale tags to the mobile supported locale', () => {
    expect(normalizeLanguageTag('zh-CN')).toBe('zh-Hans-CN')
    expect(normalizeLanguageTag('zh-Hans-CN')).toBe('zh-Hans-CN')
  })

  it('maps desktop traditional Chinese locale tags to the mobile supported locale', () => {
    expect(normalizeLanguageTag('zh-TW')).toBe('zh-Hans-TW')
    expect(normalizeLanguageTag('zh-Hant-HK')).toBe('zh-Hans-TW')
  })

  it('falls back to the app default language for unsupported values', () => {
    expect(normalizeLanguageTag('de-DE')).toBe(defaultLanguage)
    expect(normalizeLanguageTag(undefined)).toBe(defaultLanguage)
  })
})
