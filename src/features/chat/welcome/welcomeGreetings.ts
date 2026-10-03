export type GreetingSlot =
  | 'lateNight'
  | 'earlyMorning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night'

export function greetingSlotForHour(hour: number): GreetingSlot {
  if (hour < 5) return 'lateNight'
  if (hour < 9) return 'earlyMorning'
  if (hour < 12) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

export function pickGreeting(pool: readonly string[] | undefined, random: () => number = Math.random): string {
  if (!pool || pool.length === 0) return ''
  const index = Math.floor(random() * pool.length)
  return pool[Math.min(index, pool.length - 1)] ?? pool[0]
}
