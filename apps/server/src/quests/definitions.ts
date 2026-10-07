/** Things that happen in the game and can move a challenge forward. Always decided by the server. */
export type QuestEvent = 'place' | 'create' | 'visit' | 'chat' | 'friend' | 'buy' | 'sit';

export interface QuestTier {
  /** The count to reach. */
  goal: number;
  /** Pixels paid once, when it is reached. */
  reward: number;
}

export interface QuestSeries {
  key: string;
  title: string;
  description: string;
  event: QuestEvent;
  /** Increasing goals. Rewards are finite: a series can only ever pay the sum of its tiers. */
  tiers: QuestTier[];
}

export const QUESTS: readonly QuestSeries[] = [
  {
    key: 'decorateur',
    title: 'Décorateur',
    description: 'Pose des objets dans ton appart (chaque objet compte une fois).',
    event: 'place',
    tiers: [{ goal: 1, reward: 10 }, { goal: 10, reward: 30 }, { goal: 40, reward: 80 }],
  },
  {
    key: 'inventeur',
    title: 'Inventeur',
    description: 'Invente des objets uniques.',
    event: 'create',
    tiers: [{ goal: 1, reward: 30 }, { goal: 5, reward: 60 }, { goal: 20, reward: 150 }],
  },
  {
    key: 'voisin',
    title: 'Bon voisin',
    description: 'Rends visite à des apparts différents.',
    event: 'visit',
    tiers: [{ goal: 1, reward: 10 }, { goal: 5, reward: 40 }, { goal: 15, reward: 100 }],
  },
  {
    key: 'bavard',
    title: 'Bavard',
    description: 'Discute avec les autres joueurs.',
    event: 'chat',
    tiers: [{ goal: 1, reward: 5 }, { goal: 25, reward: 25 }, { goal: 150, reward: 75 }],
  },
  {
    key: 'sociable',
    title: 'Sociable',
    description: 'Fais-toi des amis.',
    event: 'friend',
    tiers: [{ goal: 1, reward: 20 }, { goal: 5, reward: 60 }, { goal: 20, reward: 150 }],
  },
  {
    key: 'boutique',
    title: 'Client fidèle',
    description: 'Fais des achats dans la boutique.',
    event: 'buy',
    tiers: [{ goal: 1, reward: 10 }, { goal: 5, reward: 30 }],
  },
  {
    key: 'repos',
    title: 'Au repos',
    description: 'Assieds-toi ou allonge-toi sur des meubles.',
    event: 'sit',
    tiers: [{ goal: 1, reward: 5 }, { goal: 10, reward: 20 }],
  },
];

/** Events that count once per thing: the reference that identifies the thing is then required. */
export const ONCE_PER_REF: ReadonlySet<QuestEvent> = new Set(['place', 'visit', 'friend']);
