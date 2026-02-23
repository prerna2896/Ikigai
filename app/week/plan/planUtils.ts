import {
  DEFAULT_WEEK_DOMAINS,
  PLOT_COLOR_KEYS,
  type DomainTask,
  type WeekPlan,
  type WeekDomain,
} from '@ikigai/core';

const DEFAULT_DOMAIN_NAMES = [...DEFAULT_WEEK_DOMAINS];

const DOMAIN_KEYWORDS: Array<{ name: string; keywords: string[] }> = [
  {
    name: 'Work / Study',
    keywords: [
      'work',
      'job',
      'meeting',
      'project',
      'client',
      'email',
      'deadline',
      'presentation',
      'shift',
      'office',
      'class',
      'course',
      'study',
      'exam',
      'lecture',
      'homework',
    ],
  },
  {
    name: 'Health',
    keywords: [
      'gym',
      'workout',
      'run',
      'exercise',
      'yoga',
      'walk',
      'health',
      'doctor',
      'therapy',
      'med',
    ],
  },
  {
    name: 'Home & Life',
    keywords: [
      'home',
      'laundry',
      'clean',
      'cook',
      'grocery',
      'chores',
      'errand',
      'dishes',
      'yard',
      'bills',
      'maintenance',
    ],
  },
  {
    name: 'Relationships',
    keywords: [
      'family',
      'friend',
      'call',
      'date',
      'partner',
      'kids',
      'parent',
      'social',
      'hangout',
    ],
  },
  {
    name: 'Personal Growth',
    keywords: [
      'read',
      'reading',
      'learn',
      'writing',
      'creative',
      'painting',
      'art',
      'ikigai',
      'gurudwara',
      'journal',
      'practice',
      'skill',
      'project',
    ],
  },
  {
    name: 'Rest & Recharge',
    keywords: [
      'rest',
      'recharge',
      'relax',
      'nap',
      'sleep',
      'downtime',
      'break',
      'recover',
    ],
  },
];

const WEEKDAY_INDEX: Record<
  WeekPlan['weekStartDay'],
  number
> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const getWeekStartISO = (
  date: Date = new Date(),
  weekStartDay: WeekPlan['weekStartDay'] = 'sunday',
  preferNextWeek: boolean = false,
): string => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayIndex = local.getDay();
  const targetIndex = WEEKDAY_INDEX[weekStartDay];
  let diff = targetIndex - dayIndex;
  if (diff > 0) {
    diff -= 7;
  }
  local.setDate(local.getDate() + diff);
  if (preferNextWeek) {
    local.setDate(local.getDate() + 7);
  }
  const year = local.getFullYear();
  const month = `${local.getMonth() + 1}`.padStart(2, '0');
  const dayStr = `${local.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
};

export const getWeekEndISO = (weekStartISO: string): string => {
  const start = new Date(`${weekStartISO}T00:00:00`);
  start.setDate(start.getDate() + 6);
  const year = start.getFullYear();
  const month = `${start.getMonth() + 1}`.padStart(2, '0');
  const dayStr = `${start.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
};

export const createDefaultWeekPlan = (
  weekStartISO: string,
  weekEndISO: string,
  weekStartDay: WeekPlan['weekStartDay'],
  weekTimeZone: string,
): WeekPlan => {
  const createdAtISO = new Date().toISOString();
  const domains: WeekDomain[] = DEFAULT_DOMAIN_NAMES.map((name, index) => ({
    id: crypto.randomUUID(),
    name,
    colorKey: PLOT_COLOR_KEYS[index % PLOT_COLOR_KEYS.length],
    plannedHours: 0,
    tasks: [],
  }));
  return {
    id: weekStartISO,
    weekStartISO,
    weekEndISO,
    weekStartDay,
    weekTimeZone,
    createdAtISO,
    domains,
    isFrozen: false,
  };
};

export const applyDefaultDomainNames = (plan: WeekPlan): WeekPlan => {
  const genericMatch = /^domain\\s+(\\d+)$/i;
  let didChange = false;
  const updatedDomains = plan.domains.map((domain, index) => {
    const trimmed = domain.name.trim();
    const match = trimmed.match(genericMatch);
    const numericIndex = match ? Number(match[1]) - 1 : null;
    const mappedByNumber =
      numericIndex !== null && DEFAULT_DOMAIN_NAMES[numericIndex]
        ? DEFAULT_DOMAIN_NAMES[numericIndex]
        : null;
    const mappedByPosition = DEFAULT_DOMAIN_NAMES[index] ?? null;
    const replacement = mappedByNumber ?? mappedByPosition;
    if (replacement && trimmed.toLowerCase().startsWith('domain')) {
      didChange = true;
      return { ...domain, name: replacement };
    }
    return domain;
  });
  return didChange ? { ...plan, domains: updatedDomains } : plan;
};

export const derivePlannedHours = (domain: WeekDomain): number => {
  return domain.tasks.reduce((sum, task) => sum + (task.plannedHours || 0), 0);
};

export const withDerivedPlannedHours = (plan: WeekPlan): WeekPlan => {
  return {
    ...plan,
    domains: plan.domains.map((domain) => ({
      ...domain,
      plannedHours: derivePlannedHours(domain),
    })),
  };
};

export const pickNextColorKey = (domains: WeekDomain[]): string => {
  const used = new Set(domains.map((domain) => domain.colorKey));
  const available = PLOT_COLOR_KEYS.find((key) => !used.has(key));
  return available ?? PLOT_COLOR_KEYS[domains.length % PLOT_COLOR_KEYS.length];
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const findDomainByName = (domains: WeekDomain[], name: string) => {
  const target = normalizeText(name);
  return domains.find((domain) => normalizeText(domain.name) === target) ?? null;
};

export const suggestDomainForTask = (
  title: string,
  domains: WeekDomain[],
): { domainId?: string; createName?: string } => {
  const normalized = normalizeText(title);
  if (!normalized) {
    return domains[0] ? { domainId: domains[0].id } : { createName: 'General' };
  }
  const matched = DOMAIN_KEYWORDS.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword)),
  );
  if (matched) {
    const existing = findDomainByName(domains, matched.name);
    if (existing) {
      return { domainId: existing.id };
    }
    return { createName: matched.name };
  }
  return domains[0] ? { domainId: domains[0].id } : { createName: 'General' };
};

export const addDomainToPlan = (
  plan: WeekPlan,
  name: string,
): { plan: WeekPlan; domain: WeekDomain } => {
  const domain: WeekDomain = {
    id: crypto.randomUUID(),
    name,
    colorKey: pickNextColorKey(plan.domains),
    plannedHours: 0,
    tasks: [],
  };
  return {
    plan: {
      ...plan,
      domains: [...plan.domains, domain],
    },
    domain,
  };
};

export type TaskView = {
  task: DomainTask;
  domain: WeekDomain;
};

export const flattenTasks = (domains: WeekDomain[]): TaskView[] => {
  return domains.flatMap((domain) =>
    domain.tasks.map((task) => ({
      task,
      domain,
    })),
  );
};

export const updateTaskInPlan = (
  plan: WeekPlan,
  domainId: string,
  taskId: string,
  updates: Partial<DomainTask>,
): WeekPlan => {
  return {
    ...plan,
    domains: plan.domains.map((domain) => {
      if (domain.id !== domainId) {
        return domain;
      }
      return {
        ...domain,
        tasks: domain.tasks.map((task) =>
          task.id === taskId ? { ...task, ...updates } : task,
        ),
      };
    }),
  };
};

export const removeTaskFromPlan = (
  plan: WeekPlan,
  domainId: string,
  taskId: string,
): WeekPlan => {
  return {
    ...plan,
    domains: plan.domains.map((domain) => {
      if (domain.id !== domainId) {
        return domain;
      }
      return {
        ...domain,
        tasks: domain.tasks.filter((task) => task.id !== taskId),
      };
    }),
  };
};

export const moveTaskToDomain = (
  plan: WeekPlan,
  taskId: string,
  fromDomainId: string,
  toDomainId: string,
): WeekPlan => {
  if (fromDomainId === toDomainId) {
    return plan;
  }
  let movedTask: DomainTask | null = null;
  const domainsWithoutTask = plan.domains.map((domain) => {
    if (domain.id !== fromDomainId) {
      return domain;
    }
    const remaining = domain.tasks.filter((task) => {
      if (task.id === taskId) {
        movedTask = task;
        return false;
      }
      return true;
    });
    return { ...domain, tasks: remaining };
  });

  if (!movedTask) {
    return plan;
  }

  const updatedDomains = domainsWithoutTask.map((domain) => {
    if (domain.id !== toDomainId) {
      return domain;
    }
    return {
      ...domain,
      tasks: [...domain.tasks, movedTask],
    };
  });

  return {
    ...plan,
    domains: updatedDomains,
  };
};
