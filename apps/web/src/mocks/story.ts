import type { StoryChoice, StoryTurn, VideoTask } from '../types'

export function createIdleVideoTask(): VideoTask {
  return {
    id: null,
    version: 1,
    taskId: null,
    providerStatus: null,
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    outcome: 'success',
    videoUrl: null,
    mediaType: null,
    error: null,
  }
}

const openingChoices: StoryChoice[] = [
  {
    id: 'choice-castle',
    label: '前往古堡探索线索',
    direction: '穿过雾桥进入山顶古堡，追查那道与月光同时亮起的窗。',
  },
  {
    id: 'choice-forest',
    label: '进入森林寻找遗迹',
    direction: '绕开守卫，沿着林中的蓝色微光寻找被遗忘的石门。',
  },
  {
    id: 'choice-harbor',
    label: '前往港口打听消息',
    direction: '返回灯火未熄的港口，从午夜摆渡人口中寻找城堡的秘密。',
  },
  {
    id: 'choice-mountain',
    label: '前往北方的雪山',
    direction: '追随地图上的银色刻痕向北，寻找俯瞰古堡的雪山观测站。',
  },
]

export function createOpeningTurn(idea: string): StoryTurn {
  const cleanIdea = idea.trim()
  return {
    id: `turn-${Date.now()}`,
    storyId: null,
    parentTurnId: null,
    title: '雾海尽头的城堡',
    storyText: `暮色沉入群山，${cleanIdea}。你在雾气散开的瞬间看见一座悬于峭壁之上的古堡。桥上的灯依次亮起，像是在回应某个迟到了很多年的约定。`,
    summary: '主角抵达雾谷，发现远处古堡发出的神秘召唤。',
    videoPrompt:
      'Cinematic wide shot of a solitary traveler overlooking a luminous gothic castle above a mist-filled valley at sunset, warm torchlight, violet clouds, realistic fantasy film, slow forward camera movement, 16:9.',
    choices: openingChoices,
    duration: 8,
    imageVariant: 0,
    createdAt: new Date().toISOString(),
    videoTask: createIdleVideoTask(),
  }
}

export function createContinuationTurn(direction: string, index: number): StoryTurn {
  const templates = [
    {
      title: '长桥上的回声',
      storyText: `你选择了：${direction} 夜风卷过石桥，桥面上浮现出一串只有月光能够照见的脚印。它们停在紧闭的大门前，却没有转身离开的痕迹。`,
      summary: '主角沿选定方向前进，在城堡入口发现不属于任何来客的脚印。',
    },
    {
      title: '遗迹下的星图',
      storyText: `你选择了：${direction} 潮湿的藤蔓后藏着一面会呼吸的石墙。你把手贴上去，群山与古堡化成星图，而其中一颗星正以你的心跳频率闪烁。`,
      summary: '主角在遗迹中触发星图，发现自己与古堡之间存在未知联系。',
    },
  ]
  const picked = templates[index % templates.length]

  return {
    id: `turn-${Date.now()}`,
    storyId: null,
    parentTurnId: null,
    title: picked.title,
    storyText: picked.storyText,
    summary: picked.summary,
    videoPrompt:
      'Cinematic fantasy sequence following the same traveler through ancient stone ruins, moonlit mist, subtle teal magical light, realistic textures, smooth tracking shot, consistent costume, 16:9.',
    choices: openingChoices.map((choice, choiceIndex) => ({
      ...choice,
      id: `${choice.id}-${index}-${choiceIndex}`,
    })),
    duration: 8,
    imageVariant: (index % 3) + 1,
    createdAt: new Date().toISOString(),
    videoTask: createIdleVideoTask(),
  }
}
