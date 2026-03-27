import { transformAssistantToDb, transformDbToAssistant } from '../assistants.mapper'

describe('assistants.mapper', () => {
  it('persists assistant avatar when writing to the database', () => {
    const dbRecord = transformAssistantToDb({
      id: 'assistant-with-avatar',
      name: 'Avatar Assistant',
      prompt: 'hello',
      topics: [],
      type: 'external',
      avatar: 'data:image/png;base64,assistant-avatar',
      emoji: '🤖'
    })

    expect(dbRecord.avatar).toBe('data:image/png;base64,assistant-avatar')
  })

  it('hydrates assistant avatar when reading from the database', () => {
    const assistant = transformDbToAssistant({
      id: 'assistant-with-avatar',
      name: 'Avatar Assistant',
      prompt: 'hello',
      topics: [],
      type: 'external',
      avatar: 'data:image/png;base64,assistant-avatar',
      emoji: '🤖'
    })

    expect(assistant).toEqual(
      expect.objectContaining({
        id: 'assistant-with-avatar',
        avatar: 'data:image/png;base64,assistant-avatar',
        emoji: '🤖'
      })
    )
  })
})
