import type {
  Plan,
  Objectives,
  Wave,
  WaveEntry,
  Task,
  Decision,
  FinalTask,
} from "../../src/model";

const emptyObjectives: Objectives = {
  mustHave: [],
  mustNot: [],
  other: [],
};

function task(id: string, checked: boolean, title: string): Task {
  return {
    id,
    checked,
    title,
    state: {},
    fields: [],
  };
}

function waveEntry(id: string, checked: boolean, title: string): WaveEntry {
  return { id, checked, title };
}

export const fixturePlan: Plan = {
  title: "Fixture Plan `title`",
  tldr: [
    { label: "Quick Summary", value: "Test summary `x`" },
    { label: "Estimated Effort", value: "Large" },
    { label: "Parallel Execution", value: "YES" },
    { label: "Critical Path", value: "T1 → T2 → T3" },
    { label: "Repos", value: "owner/repo-a · owner/repo-b" },
  ],
  objectives: emptyObjectives,
  waves: [
    {
      name: "Wave 1",
      description: "first wave",
      entries: [
        waveEntry("T1", true, "First task"),
        waveEntry("T2", false, "Second task"),
      ],
    },
  ],
  decisions: [
    {
      name: "Sample decision",
      status: "resolved",
      statusText: "Resolved",
      body: "Decision body text.",
    },
  ],
  tasks: [
    task("1", true, "Done task"),
    task("2", true, "Another done task"),
    task("3", false, "Pending task"),
  ],
  finalTasks: [
    {
      id: "F1",
      checked: true,
      title: "Final review",
      category: "oracle",
      description: "Review everything.",
    },
  ],
  warnings: [],
};

function buildSixWaves(): Wave[] {
  const waves: Wave[] = [];
  for (let i = 1; i <= 6; i++) {
    const allChecked = i === 1;
    const entries: WaveEntry[] = [
      waveEntry(`W${i}A`, allChecked, `Wave ${i} task A`),
      waveEntry(`W${i}B`, allChecked, `Wave ${i} task B`),
    ];
    waves.push({
      name: `Wave ${i}`,
      description: `wave number ${i}`,
      entries,
    });
  }
  return waves;
}

const sixWaveDecisions: Decision[] = [
  {
    name: "Wave decision",
    status: "default",
    statusText: "Default applied",
    body: "Default rationale.",
  },
];

const sixWaveFinalTasks: FinalTask[] = [
  {
    id: "F1",
    checked: false,
    title: "Compliance audit",
    category: "unspecified-high",
    description: "Audit the waves.",
  },
];

export const sixWavePlan: Plan = {
  title: "Six Wave Plan",
  tldr: [
    { label: "Quick Summary", value: "Six waves for color cycling" },
    { label: "Estimated Effort", value: "Medium" },
  ],
  objectives: emptyObjectives,
  waves: buildSixWaves(),
  decisions: sixWaveDecisions,
  tasks: [
    task("W1A", true, "Wave 1 task A"),
    task("W1B", true, "Wave 1 task B"),
    task("W2A", false, "Wave 2 task A"),
  ],
  finalTasks: sixWaveFinalTasks,
  warnings: [],
};

export const emptyTldrPlan: Plan = {
  title: "Empty TLDR Plan",
  tldr: [],
  objectives: emptyObjectives,
  waves: [],
  decisions: [],
  tasks: [
    task("1", false, "Only task"),
  ],
  finalTasks: [],
  warnings: [],
};
