const { useState, useEffect, useReducer, useCallback, useRef } = React;
console.log('%c【项目路径校验】如果你看到了这行字，说明当前页面加载的是正确的 app.js', 'color: white; background: #ef4444; padding: 4px 8px; border-radius: 4px;');

const { motion, AnimatePresence, useMotionValue, useTransform } = Motion;


// ==================== 本地存储 ====================
const STORAGE_KEY = 'spring_festival_game_v2';
const DEV_MODE_KEY = 'spring_festival_dev_mode';

const isDevMode = () => {
  try {
    const url = new URL(window.location.href);
    const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (!isLocal) return false;
  } catch (e) {
    return false;
  }
  return localStorage.getItem(DEV_MODE_KEY) === 'true';
};

const loadSavedData = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const data = saved ? JSON.parse(saved) : { 
      unlockedAchievements: [], 
      completedIdentities: [], 
      unlockedEndings: [], 
      successfulIdentities: [], 
      sharedUnlocks: [],
      playCount: 0 
    };

    if (!data.unlockedAchievements) data.unlockedAchievements = [];
    if (!data.completedIdentities) data.completedIdentities = [];
    if (!data.unlockedEndings) data.unlockedEndings = [];
    if (!data.successfulIdentities) data.successfulIdentities = [];
    if (!data.sharedUnlocks) data.sharedUnlocks = [];
    if (typeof data.playCount !== 'number') data.playCount = 0;

    // 兼容旧存档：将旧的 ID 数组转换为带时间的对象数组
    if (data.unlockedAchievements.length > 0 && typeof data.unlockedAchievements[0] === 'string') {
      data.unlockedAchievements = data.unlockedAchievements.map(id => ({ id, unlockedAt: '历史解锁' }));
    }

    // 兼容与修复：确保已完成的身份自动同步到成功列表（解决通关后不解锁的问题）
    if (Array.isArray(data.completedIdentities)) {
      data.completedIdentities.forEach(id => {
        if (!data.successfulIdentities.includes(id)) {
          data.successfulIdentities.push(id);
        }
      });
    }

    return data;
  } catch {
    return { unlockedAchievements: [], completedIdentities: [], unlockedEndings: [], successfulIdentities: [], sharedUnlocks: [] };
  }
};

const saveData = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save data:', e);
  }
};

// ==================== 状态管理 ====================
const initialState = {
  phase: 'start', // start, tutorial, identity, intro, playing, daySummary, transition, ending, failure
  identity: null,
  selectedIdentityId: null,
  day: 1,
  round: 1,
  stats: { mianzi: 50, lizi: 50 },
  history: [],
  currentCard: null,
  lastChoice: null,
  ending: null,
  failure: null,
  showingResult: false,
  dayStartStats: { mianzi: 50, lizi: 50 },
  consecutiveLeft: 0,
  consecutiveRight: 0,
  hasReachedDanger: false,
  activeTab: 'home', // home, people, achievements, about
  achievementsDefaultFilter: 'locked',
  savedData: loadSavedData()
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'START_GAME':
      return { ...state, phase: 'tutorial' };

    case 'TUTORIAL_DONE':
      return { ...state, phase: 'identity' };

    case 'SELECT_IDENTITY':
      return { ...state, selectedIdentityId: action.payload };

    case 'CONFIRM_IDENTITY': {
      const identity = IDENTITIES.find(i => i.id === action.payload);
      return {
        ...state,
        identity: identity,
        selectedIdentityId: null,
        stats: { ...identity.initialStats },
        dayStartStats: { ...identity.initialStats },
        phase: 'intro'
      };
    }

    case 'START_PLAYING': {
      const firstCard = CARDS_POOL[state.identity.id][1][0];
      return { ...state, phase: 'playing', currentCard: firstCard };
    }

    case 'MAKE_CHOICE': {
      const choice = state.currentCard.choices.find(c => c.id === action.payload);
      const newStats = {
        mianzi: Math.max(0, Math.min(100, state.stats.mianzi + choice.effects.mianzi)),
        lizi: Math.max(0, Math.min(100, state.stats.lizi + choice.effects.lizi))
      };

      const inDanger = newStats.mianzi <= 20 || newStats.mianzi >= 80 ||
                      newStats.lizi <= 20 || newStats.lizi >= 80;

      let failure = null;
      const endings = ENDINGS_BY_IDENTITY[state.identity.id]?.failure || ENDINGS_BY_IDENTITY.juanwang.failure;

      if (newStats.mianzi <= 0) failure = endings.mianzi_zero;
      else if (newStats.mianzi >= 100) failure = endings.mianzi_max;
      else if (newStats.lizi <= 0) failure = endings.lizi_zero;
      else if (newStats.lizi >= 100) failure = endings.lizi_max;

      let newConsecLeft = action.payload === 'left' ? state.consecutiveLeft + 1 : 0;
      let newConsecRight = action.payload === 'right' ? state.consecutiveRight + 1 : 0;

      const historyEntry = {
        day: state.day,
        round: state.round,
        dayName: GAME_CONFIG.dayNames[state.day],
        cardTitle: state.currentCard.title,
        choiceId: action.payload,
        choiceText: choice.text,
        effects: choice.effects
      };

      if (failure) {
        const newSavedData = { ...state.savedData };
        const now = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
        
        // --- 核心逻辑：记录唯一结局ID ---
        const failureKey = Object.keys(endings).find(key => endings[key] === failure);
        const uniqueEndingId = `ending:${state.identity.id}:${failureKey}`;
        if (!newSavedData.unlockedEndings) newSavedData.unlockedEndings = [];
        if (!newSavedData.unlockedEndings.includes(uniqueEndingId)) {
          newSavedData.unlockedEndings.push(uniqueEndingId);
        }

        // --- 统一成就判定入口 ---
        evaluateMetaAchievements(newSavedData, { 
          identityId: state.identity.id, 
          failureType: failureKey 
        });

        saveData(newSavedData);

        return {
          ...state,
          phase: 'failure',
          stats: newStats,
          lastChoice: choice,
          history: [...state.history, historyEntry],
          failure: failure,
          hasReachedDanger: state.hasReachedDanger || inDanger,
          savedData: newSavedData
        };
      }

      const updatedConsecLeft = action.payload === 'left' ? state.consecutiveLeft + 1 : 0;
      const updatedConsecRight = action.payload === 'right' ? state.consecutiveRight + 1 : 0;
      
      // 实时判定连续滑动成就
      const tempSavedData = { ...state.savedData };
      const currentUnlockedIdsTemp = new Set(tempSavedData.unlockedAchievements.map(a => typeof a === 'string' ? a : a.id));
      const nowTemp = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
      let changed = false;
      if (updatedConsecLeft >= 6 && !currentUnlockedIdsTemp.has('achievement_streak_left')) {
        tempSavedData.unlockedAchievements.push({ id: 'achievement_streak_left', unlockedAt: nowTemp });
        changed = true;
      }
      if (updatedConsecRight >= 6 && !currentUnlockedIdsTemp.has('achievement_streak_right')) {
        tempSavedData.unlockedAchievements.push({ id: 'achievement_streak_right', unlockedAt: nowTemp });
        changed = true;
      }
      if (changed) saveData(tempSavedData);

      return {
        ...state,
        stats: newStats,
        lastChoice: choice,
        history: [...state.history, historyEntry],
        showingResult: true,
        consecutiveLeft: updatedConsecLeft,
        consecutiveRight: updatedConsecRight,
        hasReachedDanger: state.hasReachedDanger || inDanger,
        savedData: changed ? tempSavedData : state.savedData
      };
    }

    case 'NEXT_ROUND': {
      let nextRound = state.round + 1;
      if (nextRound > GAME_CONFIG.roundsPerDay) {
        return { ...state, phase: 'daySummary', showingResult: false };
      }
      const nextCard = CARDS_POOL[state.identity.id][state.day][nextRound - 1];
      return { ...state, round: nextRound, currentCard: nextCard, lastChoice: null, showingResult: false };
    }

    case 'NEXT_DAY': {
      const nextDay = state.day + 1;
      if (nextDay > GAME_CONFIG.totalDays) {
        const endings = ENDINGS_BY_IDENTITY[state.identity.id]?.normal || ENDINGS_BY_IDENTITY.juanwang.normal;
        let ending;
        if (state.stats.mianzi >= 40 && state.stats.mianzi <= 60 && state.stats.lizi >= 40 && state.stats.lizi <= 60) {
          ending = { id: 'perfect_balance', ...endings.perfect_balance };
        } else if (state.stats.mianzi >= 65 && state.stats.lizi >= 30) {
          ending = { id: 'face_winner', ...endings.face_winner };
        } else if (state.stats.lizi >= 65 && state.stats.mianzi >= 30) {
          ending = { id: 'inner_peace', ...endings.inner_peace };
        } else {
          ending = { id: 'survive', ...endings.survive };
        }

        const newSavedData = { ...state.savedData };
        if (!newSavedData.completedIdentities.includes(state.identity.id)) {
          newSavedData.completedIdentities = [...newSavedData.completedIdentities, state.identity.id];
        }
        if (!newSavedData.successfulIdentities) newSavedData.successfulIdentities = [];
        if (!newSavedData.successfulIdentities.includes(state.identity.id)) {
          newSavedData.successfulIdentities = [...newSavedData.successfulIdentities, state.identity.id];
        }
        if (!newSavedData.unlockedEndings) newSavedData.unlockedEndings = [];
        const uniqueEndingId = `ending:${state.identity.id}:${ending.id}`;
        if (!newSavedData.unlockedEndings.includes(uniqueEndingId)) {
          newSavedData.unlockedEndings.push(uniqueEndingId);
        }

        // --- 统一成就判定入口（含 playCount + 局数奖杯 + 全结局 + 五身份通关 + 完美平衡）---
        evaluateMetaAchievements(newSavedData, { identityId: state.identity.id, endingId: ending.id });

        
        // 计算解锁提醒逻辑
        const prevSuccess = new Set(state.savedData.successfulIdentities || []);
        const currentId = state.identity.id;
        
        // 判定外卖员解锁（本局之前未解锁，且本局成功后满足条件）
        const wasWaimaiLocked = !(prevSuccess.has('juanwang') || prevSuccess.has('tizhinei'));
        const isWaimaiUnlocked = newSavedData.successfulIdentities.includes('juanwang') || newSavedData.successfulIdentities.includes('tizhinei');
        
        // 判定富二代解锁（本局之前未解锁，且本局成功后满足条件）
        const wasFuerdaiLocked = !(prevSuccess.has('juanwang') && prevSuccess.has('tizhinei') && prevSuccess.has('waimai'));
        const isFuerdaiUnlocked = ['juanwang', 'tizhinei', 'waimai'].every(id => newSavedData.successfulIdentities.includes(id));

        let unlockNotice = null;
        if (isWaimaiUnlocked && wasWaimaiLocked) {
          unlockNotice = "恭喜通关！您已成功解锁【外卖骑手】身份，快去体验吧！";
        } else if (isFuerdaiUnlocked && wasFuerdaiLocked) {
          unlockNotice = "恭喜通关！您已成功解锁【家族继承人】身份，快去体验吧！";
        } else if (newSavedData.successfulIdentities.length >= 4) {
          unlockNotice = "恭喜你通关所有身份，但还有更多的结局等你挑战！";
        } else if (!isFuerdaiUnlocked) {
          // 下一步目标：提示解锁富二代还差哪个
          const missing = ['juanwang', 'tizhinei', 'waimai'].find(id => !newSavedData.successfulIdentities.includes(id));
          const idToName = { juanwang: '大厂卷王', tizhinei: '体制内青年', waimai: '外卖骑手' };
          if (missing) {
            unlockNotice = `您再成功通关【${idToName[missing]}】身份，就可以解锁【家族继承人】了，快去体验吧！`;
          }
        }

        saveData(newSavedData);

        return { ...state, phase: 'ending', ending: { ...ending, unlockNotice }, savedData: newSavedData };
      }
      return { ...state, phase: 'transition', day: nextDay, round: 1, dayStartStats: { ...state.stats } };
    }

    case 'CONTINUE_DAY': {
      const card = CARDS_POOL[state.identity.id][state.day][0];
      return { ...state, phase: 'playing', currentCard: card, lastChoice: null };
    }

    case 'SET_TAB':
      return { ...state, activeTab: action.payload, achievementsDefaultFilter: action.payload === 'achievements' ? 'locked' : state.achievementsDefaultFilter };

    case 'RESTART':
      return { ...initialState, savedData: loadSavedData() };

    case 'BACK_TO_IDENTITY':
      return { ...initialState, phase: 'identity', savedData: loadSavedData() };

    case 'DEV_FORCE_ENDING': {
      const { identityId, endingId, stats } = action.payload || {};
      const identity = IDENTITIES.find(i => i.id === identityId) || IDENTITIES[0];
      const fixedStats = {
        mianzi: Math.max(0, Math.min(100, Number(stats?.mianzi ?? identity.initialStats.mianzi))),
        lizi: Math.max(0, Math.min(100, Number(stats?.lizi ?? identity.initialStats.lizi)))
      };

      const endings = ENDINGS_BY_IDENTITY[identity.id]?.normal || ENDINGS_BY_IDENTITY.juanwang.normal;
      const endingKey = endingId && endings[endingId] ? endingId : 'survive';
      const ending = { id: endingKey, ...endings[endingKey] };

      const newSavedData = { ...state.savedData };
      if (!newSavedData.completedIdentities.includes(identity.id)) {
        newSavedData.completedIdentities = [...newSavedData.completedIdentities, identity.id];
      }
      if (!newSavedData.successfulIdentities) newSavedData.successfulIdentities = [];
      if (!newSavedData.successfulIdentities.includes(identity.id)) {
        newSavedData.successfulIdentities = [...newSavedData.successfulIdentities, identity.id];
      }
      if (!newSavedData.unlockedEndings) newSavedData.unlockedEndings = [];
      if (!newSavedData.unlockedEndings.includes(ending.id)) newSavedData.unlockedEndings.push(ending.id);

      // 统一记录结局与判定成就
      const uniqueEndingId = `ending:${identity.id}:${ending.id}`;
      if (!newSavedData.unlockedEndings) newSavedData.unlockedEndings = [];
      if (!newSavedData.unlockedEndings.includes(uniqueEndingId)) {
        newSavedData.unlockedEndings.push(uniqueEndingId);
      }

      // --- 统一成就判定入口 ---
      evaluateMetaAchievements(newSavedData, { identityId: identity.id, endingId: ending.id });

      saveData(newSavedData);

      const prevSuccess = new Set(state.savedData.successfulIdentities || []);
      const wasWaimaiLocked = !(prevSuccess.has('juanwang') || prevSuccess.has('tizhinei'));
      const isWaimaiUnlocked = newSavedData.successfulIdentities.includes('juanwang') || newSavedData.successfulIdentities.includes('tizhinei');
      const wasFuerdaiLocked = !(prevSuccess.has('juanwang') && prevSuccess.has('tizhinei') && prevSuccess.has('waimai'));
      const isFuerdaiUnlocked = ['juanwang', 'tizhinei', 'waimai'].every(id => newSavedData.successfulIdentities.includes(id));

      let unlockNotice = null;
      if (isWaimaiUnlocked && wasWaimaiLocked) {
        unlockNotice = "恭喜通关！您已成功解锁【外卖骑手】身份，快去体验吧！";
      } else if (isFuerdaiUnlocked && wasFuerdaiLocked) {
        unlockNotice = "恭喜通关！您已成功解锁【家族继承人】身份，快去体验吧！";
      } else if (newSavedData.successfulIdentities.length >= 4) {
        unlockNotice = "恭喜你通关所有身份，但还有更多的结局等你挑战！";
      } else if (!isFuerdaiUnlocked) {
        const missing = ['juanwang', 'tizhinei', 'waimai'].find(id => !newSavedData.successfulIdentities.includes(id));
        const idToName = { juanwang: '大厂卷王', tizhinei: '体制内青年', waimai: '外卖骑手' };
        if (missing) {
          unlockNotice = `您再成功通关【${idToName[missing]}】身份，就可以解锁【家族继承人】了，快去体验吧！`;
        }
      }

      saveData(newSavedData);

      return {
        ...state,
        phase: 'ending',
        identity,
        selectedIdentityId: null,
        stats: fixedStats,
        ending: { ...ending, unlockNotice },
        failure: null,
        savedData: newSavedData
      };
    }

    case 'DEV_FORCE_FAILURE': {
      const { identityId, failureId } = action.payload || {};
      const identity = IDENTITIES.find(i => i.id === identityId) || state.identity || IDENTITIES[0];

      const endings = ENDINGS_BY_IDENTITY[identity.id]?.failure || ENDINGS_BY_IDENTITY.juanwang.failure;
      const key = failureId && endings[failureId] ? failureId : 'mianzi_zero';
      const failure = endings[key];

      const fixedStats = (() => {
        if (key === 'mianzi_zero') return { mianzi: 0, lizi: 50 };
        if (key === 'mianzi_max') return { mianzi: 100, lizi: 50 };
        if (key === 'lizi_zero') return { mianzi: 50, lizi: 0 };
        if (key === 'lizi_max') return { mianzi: 50, lizi: 100 };
        return { mianzi: 0, lizi: 50 };
      })();

      const newSavedData = { ...state.savedData };
      const now = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
      const currentUnlockedIds = new Set(newSavedData.unlockedAchievements.map(a => typeof a === 'string' ? a : a.id));
      const checkAndUnlock = (id) => {
        if (!currentUnlockedIds.has(id)) {
          newSavedData.unlockedAchievements.push({ id, unlockedAt: now });
        }
      };

      // v2：隐藏成就 - 祁厅长被审判
      if (identity.id === 'qitingzhang') {
        checkAndUnlock('qt_be_judged');
      }

      saveData(newSavedData);

      return {
        ...state,
        phase: 'failure',
        identity,
        selectedIdentityId: null,
        stats: fixedStats,
        currentCard: null,
        lastChoice: null,
        ending: null,
        failure,
        showingResult: false,
        savedData: newSavedData
      };
    }

    case 'DEV_GOTO': {
      const p = action.payload || {};
      const nextPhase = p.phase || state.phase;
      const identity = (p.identityId
        ? (IDENTITIES.find(i => i.id === p.identityId) || state.identity)
        : state.identity);

      const day = Math.max(1, Math.min(GAME_CONFIG.totalDays, Number(p.day ?? state.day ?? 1)));
      const round = Math.max(1, Math.min(GAME_CONFIG.roundsPerDay, Number(p.round ?? state.round ?? 1)));

      const stats = p.stats
        ? {
            mianzi: Math.max(0, Math.min(100, Number(p.stats.mianzi ?? state.stats.mianzi))),
            lizi: Math.max(0, Math.min(100, Number(p.stats.lizi ?? state.stats.lizi)))
          }
        : state.stats;

      const dayStartStats = p.dayStartStats
        ? {
            mianzi: Math.max(0, Math.min(100, Number(p.dayStartStats.mianzi ?? state.dayStartStats.mianzi))),
            lizi: Math.max(0, Math.min(100, Number(p.dayStartStats.lizi ?? state.dayStartStats.lizi)))
          }
        : state.dayStartStats;

      const currentCard = (() => {
        if (nextPhase !== 'playing') return state.currentCard;
        if (!identity?.id) return state.currentCard;
        const list = CARDS_POOL?.[identity.id]?.[day];
        if (!Array.isArray(list)) return state.currentCard;
        return list[round - 1] || list[0] || state.currentCard;
      })();

      return {
        ...state,
        phase: nextPhase,
        identity,
        day,
        round,
        stats,
        dayStartStats,
        currentCard,
        showingResult: false,
        lastChoice: null,
        ending: null,
        failure: null
      };
    }

    default:
      return state;
  }
}

// ==================== 工具函数 ====================
const audioCache = {};
const playSfx = (name) => {
  const path = `./assets/${name}.mp3`;
  if (!audioCache[name]) {
    audioCache[name] = new Audio(path);
  }
  const audio = audioCache[name];
  audio.currentTime = 0;
  audio.play().catch(() => {});
};

const bgmAudio = (() => {
  try {
    const a = new Audio('./assets/bgm.mp3');
    a.loop = true;
    a.volume = 0.2;
    a.preload = 'auto';
    return a;
  } catch (e) {
    return null;
  }
})();

/**
 * 通用富文本渲染函数
 * @param {string} text 原始文本
 * @param {'cardFront' | 'cardBack' | 'failure' | 'ending'} mode 渲染模式
 */
const DEFAULT_TEXT_PAGINATION = {
  cardFrontSummaryLines: 9,
  cardFrontPageLines: 12,
  cardBackPageLines: 12,
  endingPageLines: 14,
  failurePageLines: 14
};

const splitToPages = (text, { linesPerPage }) => {
  if (!text) return [''];

  const raw = String(text);

  // 1) 优先尊重作者换行
  let segments = [];
  if (raw.includes('\n')) {
    segments = raw
      .split('\n\n')
      .map(s => s.trim())
      .filter(Boolean);
  } else {
    // 2) 自动分句兜底（中文）
    const sentences = raw
      .split(/(?<=[。！？…])/) 
      .map(s => s.trim())
      .filter(Boolean);

    // 每 2 句合并成一个段，避免太碎
    for (let i = 0; i < sentences.length; i += 2) {
      segments.push((sentences[i] || '') + (sentences[i + 1] || ''));
    }
  }

  // 估算：按“每行约 18 个汉字”折算行数（简单可靠，不需要测量 DOM）
  const CHARS_PER_LINE = 18;
  const segLines = segments.map(seg => Math.max(1, Math.ceil(seg.length / CHARS_PER_LINE)));

  const pages = [];
  let page = [];
  let used = 0;

  for (let i = 0; i < segments.length; i++) {
    const need = segLines[i];

    if (used + need > linesPerPage && page.length > 0) {
      pages.push(page.join('\n\n'));
      page = [];
      used = 0;
    }

    page.push(segments[i]);
    used += need;
  }

  if (page.length > 0) pages.push(page.join('\n\n'));
  if (pages.length === 0) pages.push(raw);
  return pages;
};

/**
 * 通用富文本渲染函数（不滚动，配合分页）
 */
const renderRichText = (text, mode = 'cardFront') => {
  if (!text) return null;

  const styles = {
    cardFront: {
      paragraph: 'mb-4 last:mb-0',
      normal: 'text-[14px] leading-relaxed text-gray-700',
      quote: 'text-[14px] leading-relaxed text-gray-800 pl-3 border-l-2 border-gray-200 bg-gray-50/60 py-1 my-1'
    },
    cardBack: {
      paragraph: 'mb-4 last:mb-0',
      normal: 'text-[14px] leading-relaxed text-gray-700',
      quote: 'text-[14px] leading-relaxed text-gray-900 pl-3 border-l-2 border-blue-200 bg-blue-50/40 py-1 my-1'
    },
    failure: {
      paragraph: 'mb-4 last:mb-0',
      normal: 'text-[14px] leading-relaxed text-gray-300',
      quote: 'text-[14px] leading-relaxed text-white pl-3 border-l-2 border-red-500/60 bg-white/5 py-1 my-1'
    },
    ending: {
      paragraph: 'mb-4 last:mb-0',
      normal: 'text-[14px] leading-relaxed text-gray-600',
      quote: 'text-[14px] leading-relaxed text-amber-900 pl-3 border-l-2 border-amber-300 bg-amber-50/50 py-1 my-1'
    }
  };

  const s = styles[mode] || styles.cardFront;

  return String(text).split('\n\n').map((paragraph, pIdx) => (
    <div key={pIdx} className={s.paragraph}>
      {paragraph.split('\n').map((line, lIdx) => {
        const trimmed = line.trim();
        const isQuote = trimmed.startsWith('「') || trimmed.includes('“') || trimmed.includes('”');
        return (
          <p key={lIdx} className={`text-left ${isQuote ? s.quote : s.normal}`}>
            {line}
          </p>
        );
      })}
    </div>
  ));
};

const getStatStatus = (value) => {
  if (value <= 20 || value >= 80) return 'danger';
  if (value <= 30 || value >= 70) return 'warning';
  if (value >= 40 && value <= 60) return 'balanced';
  return 'normal';
};

const getEffectColor = (effect) => {
  if (effect === 0) return 'transparent';
  const intensity = Math.min(Math.abs(effect) / 15, 1);
  const alpha = 0.4 + intensity * 0.6;
  return effect > 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
};

// 检查并记录全结局奖杯（5角色）
const checkAllEndingsAchievement = (newSavedData, identityId) => {
  const types = ['mianzi_zero', 'mianzi_max', 'lizi_zero', 'lizi_max', 'perfect_balance', 'face_winner', 'inner_peace', 'survive'];
  const hasAll = types.every(type => newSavedData.unlockedEndings.includes(`ending:${identityId}:${type}`));
  if (hasAll) {
    const achievementId = identityId === 'qitingzhang' ? 'achievement_qt_all_endings' : 
                         identityId === 'waimai' ? 'achievement_waimai_all_endings' : 
                         `achievement_all_endings_${identityId}`;
    unlockInternal(newSavedData, achievementId);
  }
};

// 检查并记录累计局数奖杯
const checkPlayCountAchievements = (newSavedData) => {
  const counts = [3, 5, 10, 20, 50];
  counts.forEach(c => {
    if (newSavedData.playCount >= c) {
      unlockInternal(newSavedData, `achievement_play_${c}`);
    }
  });
};

// 检查并记录多身份通关奖杯
const checkWinIdentityAchievements = (newSavedData) => {
  const count = new Set(newSavedData.successfulIdentities || []).size;
  if (count >= 1) unlockInternal(newSavedData, 'achievement_win_1');
  if (count >= 3) unlockInternal(newSavedData, 'achievement_win_3');
  if (count >= 5) unlockInternal(newSavedData, 'achievement_win_all_5');
};

const unlockInternal = (newSavedData, achievementId) => {
  const now = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
  const currentUnlockedIds = new Set(newSavedData.unlockedAchievements.map(a => typeof a === 'string' ? a : a.id));
  if (!currentUnlockedIds.has(achievementId)) {
    newSavedData.unlockedAchievements.push({ id: achievementId, unlockedAt: now });
  }
};

const evaluateMetaAchievements = (newSavedData, context) => {
  const { identityId, endingId } = context || {};
  
  // 1. 增加局数
  newSavedData.playCount = (newSavedData.playCount || 0) + 1;
  
  // 2. 检查局数成就
  checkPlayCountAchievements(newSavedData);
  
  // 3. 检查当前身份全结局
  if (identityId) {
    checkAllEndingsAchievement(newSavedData, identityId);
  }
  
  // 4. 检查多身份通关
  checkWinIdentityAchievements(newSavedData);
  
  // 5. 特殊：完美平衡结局成就
  if (endingId === 'perfect_balance') {
    unlockInternal(newSavedData, 'achievement_perfect_balance');
  }
};

const ACHIEVEMENT_GROUPS = {
  identity: { id: 'identity', name: '身份通关' },
  ending: { id: 'ending', name: '结局收集' },
  challenge: { id: 'challenge', name: '挑战' },
  hidden: { id: 'hidden', name: '隐藏成就' }
};

const buildAchievements = () => {

  const identityAchievements = (IDENTITIES || []).map((i) => ({
    id: `win_${i.id}`,
    group: 'identity',
    hidden: false,
    name: `${i.name}·通关`,
    emoji: '🏅',
    description: `以【${i.name}】身份成功通关一次`,
    unlockHint: `以【${i.name}】身份通关一次`
  }));

  const endingMeta = [
    { id: 'perfect_balance', name: '完美平衡', hint: '通关时面子40~60且里子40~60' },
    { id: 'face_winner', name: '衣锦还乡', hint: '通关时面子≥65且里子≥30' },
    { id: 'inner_peace', name: '做回自己', hint: '通关时里子≥65且面子≥30' },
    { id: 'survive', name: '平安落地', hint: '成功通关但未达成前三种结局' }
  ];

  const endingAchievements = [
    ...endingMeta.map(e => ({
      id: `ending_${e.id}`,
      group: 'ending',
      hidden: false,
      name: `结局·${e.name}`,
      emoji: '🏅',
      description: `达成结局：${e.name}`,
      unlockHint: e.hint
    })),
    {
      id: 'ending_all_4',
      group: 'ending',
      hidden: false,
      name: '结局收藏家',
      emoji: '🏅',
      description: '集齐四种成功结局类型',
      unlockHint: '达成：完美平衡 / 衣锦还乡 / 做回自己 / 平安落地'
    }
  ];

  const challengeAchievements = [
    { id: 'on_the_edge', group: 'challenge', hidden: false, name: '走钢丝', emoji: '🏅', description: '在崩溃边缘试探', unlockHint: '一局内数值曾触及危险区（≤20或≥80）' },
    { id: 'all_left', group: 'challenge', hidden: true, name: '一路向左', emoji: '🏅', description: '连续多次选择左边', unlockHint: '一局内连续 7 次选择左边' },
    { id: 'all_right', group: 'challenge', hidden: true, name: '一路向右', emoji: '🏅', description: '连续多次选择右边', unlockHint: '一局内连续 7 次选择右边' },

    { id: 'qt_win_perfect_balance', group: 'challenge', hidden: true, name: '祁厅长·胜天半子', emoji: '🏅', description: '祁厅长也有平衡的一面', unlockHint: '以【祁厅长】身份达成完美平衡结局' },
    { id: 'qt_be_judged', group: 'challenge', hidden: true, name: '祁厅长·被审判', emoji: '🏅', description: '爽局也会迎来清算', unlockHint: '以【祁厅长】身份触发任意失败结局' }
  ];

  const legacyAchievements = [
    { id: 'first_day', group: 'challenge', hidden: true, name: '初来乍到', emoji: '🏅', description: '完成春节第一天', unlockHint: '完成第 1 天' },
    { id: 'halfway', group: 'challenge', hidden: true, name: '过半了', emoji: '🏅', description: '春节假期过半', unlockHint: '完成第 4 天' },
    { id: 'survivor', group: 'challenge', hidden: true, name: '幸存者', emoji: '🏅', description: '活着度过了春节', unlockHint: '成功通关任意身份' },
    { id: 'perfect_balance', group: 'challenge', hidden: true, name: '完美平衡', emoji: '🏅', description: '面子里子都顾到了', unlockHint: '获得完美平衡结局' },
    { id: 'face_master', group: 'challenge', hidden: true, name: '面子达人', emoji: '🏅', description: '风光无限', unlockHint: '通关时面子≥70' },
    { id: 'inner_peace', group: 'challenge', hidden: true, name: '内心富足', emoji: '🏅', description: '守住了内心', unlockHint: '通关时里子≥70' },
    { id: 'multi_identity', group: 'challenge', hidden: true, name: '百变人生', emoji: '🏅', description: '体验不同的人生', unlockHint: '用 2 个身份通关' }
  ];

  const all = [...identityAchievements, ...endingAchievements, ...challengeAchievements, ...legacyAchievements];

  // 去重（若未来出现重复 id，以前者为准）
  const seen = new Set();
  return all.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
};

const ACHIEVEMENTS_V2 = buildAchievements();

const getUnlockedMap = (savedData) => {
  const unlockedList = Array.isArray(savedData?.unlockedAchievements) ? savedData.unlockedAchievements : [];
  return new Map(
    unlockedList
      .filter(x => x && typeof x === 'object')
      .map(x => [x.id, x.unlockedAt])
  );
};

const hasUnlocked = (unlockedMap, id) => unlockedMap.has(id);

const getNextGoalText = (savedData) => {
  const successSet = new Set(savedData?.successfulIdentities || []);
  const next = (IDENTITIES || []).find(i => !successSet.has(i.id));
  if (next) return `下一个目标：以【${next.name}】身份通关一次`;

  const endingsSet = new Set(savedData?.unlockedEndings || []);
  const endingMissing = ['perfect_balance', 'face_winner', 'inner_peace', 'survive'].find(id => !endingsSet.has(id));
  if (endingMissing) {
    const nameMap = { perfect_balance: '完美平衡', face_winner: '衣锦还乡', inner_peace: '做回自己', survive: '平安落地' };
    return `下一个目标：达成结局【${nameMap[endingMissing]}】`;
  }

  return '你已经非常强了：试试解锁隐藏成就';
};

// ==================== 组件 ====================

// 成就页（列表页：允许滚动）
const showUnderConstruction = (title = '施工中') => {
  alert(`${title}：施工中，档案尚未整理。`);
};

const PEOPLE_TEASER = {
  title: '人物（未整理）',
  subtitle: '像一张被随手夹进日记本的便签。你看见了，但还看不懂。',
  files: [
    {
      id: 'p1',
      codename: '同学会发起人',
      line: '她笑着点名，但没人敢接话。'
    },
    {
      id: 'p2',
      codename: '镇上做生意的人',
      line: '他说“随便坐”，却把座位排好了。'
    },
    {
      id: 'p3',
      codename: '一直在拍的人',
      line: '镜头对准你时，他从不眨眼。'
    }
  ],
  redactedLinks: [
    {
      id: 'r1',
      left: '同学会发起人',
      right: '镇上做生意的人',
      line: '“那笔钱”其实不是赞助。'
    },
    {
      id: 'r2',
      left: '一直在拍的人',
      right: '同学会发起人',
      line: '删掉的那 3 秒，比留下的更完整。'
    }
  ],
  footer: '注：以上内容不会影响游戏数值，仅为后续剧情预告。'
};

const PeopleTab = ({ savedData }) => {
  const unlockedEndings = new Set(savedData?.unlockedEndings || []);
  const [openRoleId, setOpenRoleId] = useState(null);

  const identities = [
    { id: 'juanwang', name: '大厂卷王', avatar: './assets/avatars/juanwang.png' },
    { id: 'tizhinei', name: '体制内青年', avatar: './assets/avatars/tizhinei.png' },
    { id: 'waimai', name: '外卖骑手', avatar: './assets/avatars/waimai.png' },
    { id: 'fuerdai', name: '家族继承人', avatar: './assets/avatars/fuerdai.png' },
    { id: 'qitingzhang', name: '汉东祁厅长', avatar: './assets/avatars/qitingzhang.png' }
  ].filter(i => ENDINGS_BY_IDENTITY?.[i.id]);

  const endingTypes = ['perfect_balance', 'face_winner', 'inner_peace', 'survive', 'mianzi_zero', 'mianzi_max', 'lizi_zero', 'lizi_max'];

  const getEndingDisplayName = (type, data) => {
    if (!data) return type;
    return data.name || data.title || type;
  };

  const getConditionText = (type) => {
    const map = {
      mianzi_zero: '面子归零',
      mianzi_max: '面子爆满',
      lizi_zero: '里子归零',
      lizi_max: '里子爆满',
      perfect_balance: '完美平衡 (40-60)',
      face_winner: '面子达人 (≥65)',
      inner_peace: '守住内心 (里子≥65)',
      survive: '平安落地 (存活)'
    };
    return map[type] || '—';
  };

  return (
    <div className="space-y-6 pb-24 px-1">
      <div className="bg-gradient-to-br from-red-600 to-rose-700 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <div className="text-[10px] tracking-[0.3em] text-white/70 font-black uppercase">Collection</div>
          <div className="text-2xl font-black mt-1">结局画册</div>
          <div className="text-xs text-white/80 mt-2 font-medium">在故乡的烟火中，记录每一种可能的人生。</div>
        </div>
        <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
      </div>

      {identities.map(role => {
        const normal = ENDINGS_BY_IDENTITY?.[role.id]?.normal || {};
        const failure = ENDINGS_BY_IDENTITY?.[role.id]?.failure || {};

        const unlockedCount = endingTypes.filter(type =>
          unlockedEndings.has(`ending:${role.id}:${type}`)
        ).length;

        const isOpen = openRoleId === role.id;

        return (
          <div key={role.id} className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenRoleId(prev => (prev === role.id ? null : role.id))}
              className="w-full text-left bg-gray-50/50 px-6 py-5 flex items-center gap-4 border-b border-gray-100"
            >
              <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-white shadow-md bg-white shrink-0">
                <img src={role.avatar} alt={role.name} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-gray-900 text-lg">{role.name}</h3>
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white border border-gray-100 text-gray-500">
                      已达成 {unlockedCount}/8
                    </div>
                    <div className="text-gray-400 font-black">{isOpen ? '▲' : '▼'}</div>
                  </div>
                </div>
                <div className="flex gap-1 mt-1.5">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full ${i < unlockedCount ? 'bg-rose-500' : 'bg-gray-200'}`} />
                  ))}
                </div>
              </div>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="p-3">
                    <div className="grid grid-cols-1 gap-2">
                      {endingTypes.map(type => {
                        const data = (type in normal) ? normal[type] : failure[type];
                        const uniqueId = `ending:${role.id}:${type}`;
                        const isUnlocked = unlockedEndings.has(uniqueId);

                        return (
                          <div
                            key={uniqueId}
                            className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${
                              isUnlocked
                                ? 'bg-rose-50/30'
                                : 'bg-transparent grayscale opacity-60'
                            }`}
                          >
                            <div className="text-xl shrink-0">
                              {isUnlocked ? '✅' : '🔒'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-bold truncate ${isUnlocked ? 'text-gray-900' : 'text-gray-400'}`}>
                                {getEndingDisplayName(type, data)}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5 truncate">
                                {getConditionText(type)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};

// 成就页（列表页：允许滚动）
const ACHIEVEMENT_GROUPS_V3 = {
  ultimate: { id: 'ultimate', name: '终极挑战' },
  career: { id: 'career', name: '生涯统计' },
  footprint: { id: 'footprint', name: '身份足迹' },
  challenge: { id: 'challenge', name: '操作挑战' }
};

const ACHIEVEMENTS_V3 = [
  // 终极挑战：五角色全结局
  { id: 'achievement_all_endings_juanwang', group: 'ultimate', name: '卷王·全结局', emoji: '🏆', description: '解锁【大厂卷王】全部 8 个结局', unlockHint: '集齐该身份 4 通关 + 4 失败结局' },
  { id: 'achievement_all_endings_tizhinei', group: 'ultimate', name: '体制内·全结局', emoji: '🏆', description: '解锁【体制内青年】全部 8 个结局', unlockHint: '集齐该身份 4 通关 + 4 失败结局' },
  { id: 'achievement_waimai_all_endings', group: 'ultimate', name: '外卖员·全结局', emoji: '🏆', description: '解锁【外卖骑手】全部 8 个结局', unlockHint: '集齐该身份 4 通关 + 4 失败结局' },
  { id: 'achievement_all_endings_fuerdai', group: 'ultimate', name: '继承人·全结局', emoji: '🏆', description: '解锁【家族继承人】全部 8 个结局', unlockHint: '集齐该身份 4 通关 + 4 失败结局' },
  { id: 'achievement_qt_all_endings', group: 'ultimate', name: '祁厅长·全结局', emoji: '🏆', description: '解锁【汉东祁厅长】全部 8 个结局', unlockHint: '集齐该身份 4 通关 + 4 失败结局' },

  // 身份足迹：通关多个身份
  { id: 'achievement_win_1', group: 'footprint', name: '初来乍到', emoji: '🥉', description: '成功通关任意 1 个身份', unlockHint: '完成任意身份的通关结局' },
  { id: 'achievement_win_3', group: 'footprint', name: '多面人生', emoji: '🥈', description: '成功通关 3 个不同身份', unlockHint: '通关 3 个不同身份' },
  { id: 'achievement_win_all_5', group: 'footprint', name: '五路通关', emoji: '🥇', description: '成功通关全部 5 个身份', unlockHint: '通关 5 个不同身份' },

  // 生涯统计：累计游玩局数（包含 DEV 触发的结局）
  { id: 'achievement_play_3', group: 'career', name: '牛刀小试', emoji: '🎮', description: '累计完成 3 局', unlockHint: '完成任意 3 次结局（通关或失败均计入）' },
  { id: 'achievement_play_5', group: 'career', name: '渐入佳境', emoji: '🎮', description: '累计完成 5 局', unlockHint: '完成任意 5 次结局（通关或失败均计入）' },
  { id: 'achievement_play_10', group: 'career', name: '轻车熟路', emoji: '🎮', description: '累计完成 10 局', unlockHint: '完成任意 10 次结局（通关或失败均计入）' },
  { id: 'achievement_play_20', group: 'career', name: '春节常客', emoji: '🎮', description: '累计完成 20 局', unlockHint: '完成任意 20 次结局（通关或失败均计入）' },
  { id: 'achievement_play_50', group: 'career', name: '人间百态', emoji: '🎮', description: '累计完成 50 局', unlockHint: '完成任意 50 次结局（通关或失败均计入）' },

  // 操作挑战
  { id: 'achievement_streak_left', group: 'challenge', name: '一路向左', emoji: '⬅️', description: '连续往左滑动 6 次', unlockHint: '在单局内连续选择 6 次左侧选项' },
  { id: 'achievement_streak_right', group: 'challenge', name: '一路向右', emoji: '➡️', description: '连续往右滑动 6 次', unlockHint: '在单局内连续选择 6 次右侧选项' },
  { id: 'achievement_perfect_balance', group: 'challenge', name: '完美平衡', emoji: '⚖️', description: '达成一次“完美平衡”结局', unlockHint: '通关时面子与里子均在 40-60 之间' }
];

const AchievementsTab = ({ savedData, onBack }) => {
  const unlockedMap = getUnlockedMap(savedData);
  const totalCount = ACHIEVEMENTS_V3.length;
  const unlockedCount = unlockedMap.size;
  const [openGroupIds, setOpenGroupIds] = useState(['ultimate']); // 默认展开第一组

  const toggleGroup = (groupId) => {
    setOpenGroupIds(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden min-h-0 bg-gray-50/30">
      <div className="shrink-0 p-6 pb-4 bg-white border-b border-gray-100 z-10 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-2xl font-black text-gray-900">成就收藏</div>
          <div className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
            已达成 {unlockedCount}/{totalCount}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="text-[10px] font-black text-gray-400 tracking-widest uppercase">Career Statistics</div>
          <div className="h-[1px] flex-1 bg-gray-100" />
          <div className="text-[11px] font-bold text-rose-500">累计游玩 {savedData.playCount || 0} 局</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-8 pb-24">
        {Object.values(ACHIEVEMENT_GROUPS_V3).map(group => {
          const groupItems = ACHIEVEMENTS_V3.filter(a => a.group === group.id);
          if (groupItems.length === 0) return null;
          const isOpen = openGroupIds.includes(group.id);

          return (
            <div key={group.id} className="space-y-4">
              <button 
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center gap-3 active:opacity-70 transition-opacity"
              >
                <div className="w-1.5 h-4 bg-rose-500 rounded-full" />
                <h3 className="text-sm font-black text-gray-900 tracking-tight">{group.name}</h3>
                <span className="text-[10px] text-gray-400 font-bold ml-auto">
                  {groupItems.filter(a => unlockedMap.has(a.id)).length} / {groupItems.length}
                </span>
                <div className="text-gray-400 text-xs ml-1">
                  {isOpen ? '▲' : '▼'}
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-1 gap-3 pt-1">
                      {groupItems.map(a => {
                        const isUnlocked = unlockedMap.has(a.id);
                        const unlockedAt = unlockedMap.get(a.id);

                        return (
                          <motion.div
                            key={a.id}
                            className={`p-5 rounded-3xl border-2 transition-all ${
                              isUnlocked
                                ? 'bg-white border-rose-100 shadow-[0_4px_20px_rgba(225,29,72,0.05)]'
                                : 'bg-gray-100/50 border-gray-100 grayscale brightness-95'
                            }`}
                          >
                            <div className="flex gap-4">
                              <div className={`text-3xl flex shrink-0 items-center justify-center w-14 h-14 rounded-2xl ${
                                isUnlocked ? 'bg-rose-50' : 'bg-gray-200/50'
                              }`}>
                                {isUnlocked ? a.emoji : '🔒'}
                              </div>

                              <div className="flex-1 min-w-0 py-0.5">
                                <div className="flex items-center justify-between mb-1">
                                  <h4 className={`font-black text-sm ${isUnlocked ? 'text-gray-900' : 'text-gray-400'}`}>
                                    {a.name}
                                  </h4>
                                  {isUnlocked && (
                                    <div className="text-[14px]">✨</div>
                                  )}
                                </div>
                                <p className={`text-[11px] leading-relaxed ${isUnlocked ? 'text-gray-600' : 'text-gray-400'}`}>
                                  {a.description}
                                </p>
                                {!isUnlocked && (
                                  <div className="mt-2 text-[10px] text-rose-600/60 font-medium">
                                    条件：{a.unlockHint}
                                  </div>
                                )}
                                {isUnlocked && unlockedAt && (
                                  <div className="mt-2 text-[9px] text-gray-400 font-medium flex items-center gap-1">
                                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                                    达成于 {unlockedAt}
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};


// 开始页面 (集成背景图)
const StartScreen = ({ onStart }) => (
  <motion.div className="flex flex-col min-h-screen px-6 py-10 relative overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="absolute inset-0 z-0 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: 'url("./assets/loading-bg.png")', backgroundColor: '#fef2f2' }} />
    <div className="absolute inset-0 z-10 bg-black/20" />
    <div className="flex-1 relative z-20" />
    <motion.button onClick={onStart} className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold text-lg shadow-lg relative z-20" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>开始游戏</motion.button>
  </motion.div>
);

// 新手教程页面
const TutorialScreen = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 6000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div 
      className="flex flex-col min-h-screen relative overflow-hidden cursor-pointer" 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onComplete}
    >
      <div 
        className="absolute inset-0 z-0 bg-contain bg-center bg-no-repeat" 
        style={{ backgroundImage: 'url("./assets/jiaocheng.png")', backgroundColor: '#000' }} 
      />
      <motion.div 
        className="absolute bottom-10 left-0 right-0 text-center text-white/60 text-sm z-10"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        点击任意位置跳过
      </motion.div>
    </motion.div>
  );
};

// 身份选择
const IdentitySelect = ({ selectedId, onSelect, onConfirm, savedData, onShareUnlock }) => {
  const [activeId, setActiveId] = useState(null);
  const successSet = new Set(savedData?.successfulIdentities || []);

  const getLockInfo = (identity) => {
    let locked = false;
    let unlockHint = "";

    const hasJuanwangSuccess = successSet.has('juanwang');
    const hasTizhineiSuccess = successSet.has('tizhinei');
    const hasWaimaiSuccess = successSet.has('waimai');

    if (identity.id === 'waimai' && !(hasJuanwangSuccess || hasTizhineiSuccess)) {
      locked = true;
      unlockHint = "大厂卷王/体制内青年任意一个达成成功结局解锁";
    } else if (identity.id === 'fuerdai' && !(hasJuanwangSuccess && hasTizhineiSuccess && hasWaimaiSuccess)) {
      locked = true;
      unlockHint = "分享一次即可解锁";
    } else if (identity.id === 'qitingzhang' && successSet.size < 3) {
      locked = true;
      unlockHint = "成功通关任意3个角色即可开启爽局";
    }

    if (locked && identity.id === 'fuerdai' && Array.isArray(savedData?.sharedUnlocks) && savedData.sharedUnlocks.includes('fuerdai')) {
      locked = false;
      unlockHint = "";
    }

    return { locked, unlockHint };
  };

  const handleOpen = (identity) => {
    const { locked } = getLockInfo(identity);
    onSelect(identity.id);
    setActiveId(identity.id);

  };

  const activeIdentity = activeId ? IDENTITIES.find(i => i.id === activeId) : null;

  return (
    <motion.div
      className="flex flex-col h-screen px-6 pt-10 pb-6 bg-white overflow-hidden relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-2">请选择你的身份:</h2>
      <p className="text-gray-400 mb-6 text-sm">点击头像展开查看详情</p>

      <div
        className="grid grid-cols-2 gap-4 flex-1 min-h-0 overflow-y-auto pb-6 pr-1"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
      >
        {IDENTITIES.map((identity) => {
          const { locked } = getLockInfo(identity);
          const isSelected = selectedId === identity.id;
          const avatarSrc = `./assets/avatars/${identity.id}.png`;

          return (
            <motion.button
              key={identity.id}
              type="button"
              layoutId={`identity-card-${identity.id}`}
              onClick={() => handleOpen(identity)}
              className={`relative rounded-3xl border-2 p-4 bg-white shadow-sm overflow-hidden aspect-square flex flex-col items-center justify-center text-center transition-colors ${
                isSelected ? 'border-red-500 ring-2 ring-red-500/20' : 'border-gray-200'
              } ${locked ? 'opacity-60' : ''}`}
              whileTap={{ scale: 0.98 }}
            >
              <div className={`w-20 h-20 rounded-2xl overflow-hidden border ${isSelected ? 'border-red-200' : 'border-gray-100'} bg-gray-50 flex items-center justify-center`}>
                <img
                  src={avatarSrc}
                  alt={identity.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const next = e.currentTarget.nextElementSibling;
                    if (next) next.style.display = 'block';
                  }}
                />
                <div style={{ display: 'none' }} className="text-4xl">{identity.emoji}</div>
              </div>

              <div className="mt-3 font-black text-gray-900">{identity.name}</div>

              {locked && (
                <div className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full bg-gray-200 text-gray-600">未解锁</div>
              )}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {activeIdentity && (() => {
          const { locked, unlockHint } = getLockInfo(activeIdentity);
          const avatarSrc = `./assets/avatars/${activeIdentity.id}.png`;

          return (
            <motion.div
              key="identity-overlay"
              className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveId(null)}
            >
              <motion.div
                layoutId={`identity-card-${activeIdentity.id}`}
                className="w-full max-w-sm bg-white rounded-[40px] shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-44 bg-amber-50 relative flex items-center justify-center">
                  <div className="absolute inset-0">
                    <img
                      src={avatarSrc}
                      alt={activeIdentity.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const next = e.currentTarget.nextElementSibling;
                        if (next) next.style.display = 'flex';
                      }}
                    />
                    <div style={{ display: 'none' }} className="w-full h-full flex items-center justify-center text-7xl">{activeIdentity.emoji}</div>
                    <div className="absolute inset-0 bg-black/10" />
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveId(null)}
                    className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/70 backdrop-blur flex items-center justify-center text-xl text-gray-700"
                  >
                    ×
                  </button>
                </div>

                <div className="p-7">
                  <div className="text-2xl font-black text-gray-900">{activeIdentity.name}</div>
                  <div className="text-sm text-gray-500 mt-1">{activeIdentity.subtitle}</div>

                  <div className="mt-4 bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm text-gray-700 leading-relaxed">
                    {locked ? (
                      <div className="text-center">
                        <div className="text-3xl mb-2">🔒</div>
                        <div className="font-bold text-gray-900 mb-1">身份尚未解锁</div>
                        <div className="text-xs text-gray-500">{unlockHint}</div>

                        {activeIdentity.id === 'fuerdai' && (
                          <button
                            type="button"
                            onClick={() => onShareUnlock && onShareUnlock('fuerdai')}
                            className="mt-4 px-5 py-2 rounded-full bg-red-500 text-white text-sm font-bold shadow"
                          >
                            分享解锁
                          </button>
                        )}
                      </div>
                    ) : (
                      activeIdentity.description
                    )}
                  </div>

                  <div className="mt-6">
                    <div className="text-xs text-gray-400 mb-3 text-center">
                      已选择：<span className="font-bold text-gray-900">{activeIdentity.name}</span>，点击下方开始进入剧情
                    </div>

                    <motion.button
                      type="button"
                      disabled={locked}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!locked) {
                          setActiveId(null); // 立即关闭详情态，防止阻塞组件卸载动画
                          // 点击“进入春节”前预加载开场视频，减少进入 intro 时的等待
                          try {
                            const v = document.createElement('video');
                            v.preload = 'auto';
                            v.src = `./assets/${activeIdentity.id}_kaitou.mp4`;
                            v.load();
                          } catch (e) {}

                          onConfirm(activeIdentity.id);
                        }
                      }}
                      className={`w-full py-4 rounded-2xl font-black shadow-xl transition-all ${
                        locked
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-red-500 to-rose-500 text-white active:scale-95'
                      }`}
                      animate={!locked ? { scale: [1, 1.02, 1] } : {}}
                      transition={!locked ? { duration: 1.2, repeat: Infinity } : {}}
                    >
                      进入春节（{activeIdentity.name}）
                    </motion.button>

                    <button
                      type="button"
                      onClick={() => setActiveId(null)}
                      className="w-full py-3 mt-3 rounded-2xl bg-gray-100 text-gray-600 font-bold"
                    >
                      返回
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </motion.div>
  );
};

// 故事开场短视频组件
const OpeningVideo = ({ identity, onComplete }) => {
  const videoRef = useRef(null);
  const identityId = identity?.id;

  const config = (typeof STORY_VIDEO_CONFIG !== 'undefined' && STORY_VIDEO_CONFIG)
    ? STORY_VIDEO_CONFIG
    : null;

  const [canPlay, setCanPlay] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // 按命名规则拼接：{identityId}_kaitou.mp4
  const src = identityId ? `./assets/${identityId}_kaitou.mp4` : null;

  useEffect(() => {
    setCanPlay(true);
    setIsPlaying(false);
    setIsReady(false);
  }, [identityId]);

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.warn("Auto-play with sound blocked by browser:", err);
      });
    }
  };

  useEffect(() => {
    if (src && canPlay) {
      handlePlay();
    }
  }, [src, canPlay]);

  if (!config || !src || !canPlay) {
    useEffect(() => { onComplete(); }, [onComplete]);
    return null;
  }

  const handleEnded = () => {
    onComplete();
  };

  return (
    <motion.div 
      className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center overflow-hidden cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handlePlay}
    >
      <video
        ref={videoRef}
        src={src}
        poster={config.poster}
        className="w-full h-full object-cover"
        playsInline
        onEnded={handleEnded}
        onError={() => setCanPlay(false)}
        onCanPlay={() => setIsReady(true)}
        onPlay={() => setIsPlaying(true)}
      />
      
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <motion.div 
            className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <div className="w-0 h-0 border-t-[15px] border-t-transparent border-l-[25px] border-l-white border-b-[15px] border-b-transparent ml-2" />
          </motion.div>
          <p className="absolute bottom-1/3 text-white/80 text-sm font-medium">点击播放视频（带声音）</p>
        </div>
      )}

      {config.allowSkip && (
        <motion.button
          onClick={onComplete}
          className="absolute bottom-10 right-6 px-5 py-2.5 bg-black/40 backdrop-blur-md border border-white/20 text-white rounded-full text-sm font-medium tracking-wide z-10 shadow-lg"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
        >
          跳过
        </motion.button>
      )}

      <motion.div 
        className="absolute bottom-24 left-0 right-0 text-center text-white/60 text-xs tracking-[0.2em] pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.6, 0] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        春节冒险记 · 2026
      </motion.div>
    </motion.div>
  );
};

// 故事介绍（打字机模式）
const StoryIntro = ({ identity, onComplete }) => {
  const [displayText, setDisplayText] = useState('');
  const [isFinished, setIsFinished] = useState(false);
  const fullText = (typeof STORY_INTRO !== 'undefined' && identity?.id && STORY_INTRO[identity.id]) ? STORY_INTRO[identity.id] : identity.description;
  const index = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      if (index.current < fullText.length) {
        setDisplayText(prev => prev + fullText.charAt(index.current));
        index.current += 1;
      } else {
        clearInterval(timer);
        setIsFinished(true);
        // 播报完自动进入游戏
        setTimeout(onComplete, 1000);
      }
    }, 50);

    return () => clearInterval(timer);
  }, [fullText, onComplete]);

  return (
    <motion.div
      className="flex flex-col min-h-screen px-8 py-12 relative overflow-hidden cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => {
        if (!isFinished) {
          setDisplayText(fullText);
          setIsFinished(true);
          index.current = fullText.length;
        } else {
          onComplete();
        }
      }}
    >
      <div 
        className="absolute inset-0 z-0 bg-contain bg-center bg-no-repeat"
        style={{ 
          backgroundImage: 'url("./assets/loading-bg.png")',
          backgroundColor: '#111827'
        }}
      />
      <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm" />

      <div className="flex-1 flex flex-col items-center justify-center relative z-20 text-white text-center">
        <motion.div className="text-6xl mb-8" initial={{ scale: 0 }} animate={{ scale: 1 }}>{identity.emoji}</motion.div>
        <h2 className="text-2xl font-bold mb-6 text-red-400">{identity.name}</h2>
        <div className="text-lg leading-relaxed min-h-[12rem] bg-black/20 p-6 rounded-2xl border border-white/10">
          {displayText}
          <motion.span 
            animate={{ opacity: [0, 1, 0] }} 
            transition={{ duration: 0.8, repeat: Infinity }}
            className="inline-block w-1 h-5 bg-red-500 ml-1 translate-y-1"
          />
        </div>
      </div>

      <motion.div 
        className="text-center text-white/40 text-sm relative z-20 mt-8"
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        {isFinished ? '点击任意位置开始游戏' : '点击跳过播报'}
      </motion.div>
    </motion.div>
  );
};

// 数值条
const StatBar = ({ label, value, previewEffect, previewProgress = 0 }) => {
  // 规则：=0 失败；=100（爆棚）也失败；安全区固定
  const SAFE_MIN = 20;
  const SAFE_MAX = 80;
  const isDanger = value <= SAFE_MIN || value >= SAFE_MAX;

  // 色彩规则：只有绿/红两种
  const barColor = isDanger ? 'bg-red-500' : 'bg-green-500';

  const isIncreasing = (previewEffect || 0) > 0;
  const isLargeChange = Math.abs(previewEffect || 0) >= 15;

  // 预览后可能到达的值（用于提示用户“归零/爆棚都会失败”）
  const previewValue = Math.max(0, Math.min(100, value + (previewEffect || 0)));
  const willFailZero = previewValue <= 0;
  const willFailMax = previewValue >= 100;

  const dangerHint = value <= SAFE_MIN
    ? '接近归零（归零失败）'
    : value >= SAFE_MAX
      ? '接近爆棚（爆棚失败）'
      : '';

  const failHint = willFailZero ? '归零会失败' : willFailMax ? '爆棚会失败' : '';

  return (
    <div className="flex-1">
      <div className="flex justify-between mb-1 items-center h-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          <span className={`text-[10px] font-semibold ${isDanger ? 'text-red-500' : 'text-green-600'}`}>{dangerHint}</span>
        </div>

        <AnimatePresence>
          {previewEffect !== 0 && previewEffect && (
            <motion.div
              initial={{ opacity: 0, x: isIncreasing ? -5 : 5 }}
              animate={{
                opacity: previewProgress * 0.8,
                x: 0,
                scale: isLargeChange ? [1, 1.15, 1] : 1
              }}
              exit={{ opacity: 0 }}
              transition={{
                scale: { repeat: Infinity, duration: 1 },
                opacity: { duration: 0.2 }
              }}
              className={`text-[10px] font-black ${isIncreasing ? 'text-green-600' : 'text-red-500'} flex items-center gap-1`}
            >
              {failHint ? (
                <span className="text-red-500 font-bold">{failHint}</span>
              ) : (
                <>
                  {isIncreasing ? '▲' : '▼'}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden shadow-inner">
        {/* 两端危险区底色（提示：两头红，中间绿） */}
        <div className="absolute inset-0 z-0">
          <div className="absolute left-0 top-0 h-full w-[20%] bg-red-200/70" />
          <div className="absolute left-[20%] top-0 h-full w-[60%] bg-green-200/40" />
          <div className="absolute right-0 top-0 h-full w-[20%] bg-red-200/70" />
        </div>

        {/* 中间平衡线（50%） */}
        <div className="absolute left-1/2 top-0 z-20 h-full w-[2px] -translate-x-1/2 bg-white/70" />

        {/* 动态预览光晕层（只提示方向，不引入第三种主色；仍用红/绿） */}
        {previewEffect !== 0 && (
          <motion.div
            className={`absolute inset-y-0 z-10 ${isIncreasing ? 'bg-green-400/25' : 'bg-red-400/25'}`}
            initial={{ width: `${value}%` }}
            animate={{
              width: `${previewValue}%`,
              opacity: [previewProgress * 0.25, previewProgress * 0.45, previewProgress * 0.25]
            }}
            transition={{ opacity: { repeat: Infinity, duration: 1.5 } }}
          />
        )}

        {/* 真实进度条 */}
        <motion.div
          className={`h-full ${barColor} relative z-30 rounded-full`}
          animate={{
            width: `${value}%`,
            opacity: isDanger ? [1, 0.7, 1] : 1
          }}
          transition={{
            width: { duration: 0.5 },
            opacity: isDanger ? { repeat: Infinity, duration: 1.2 } : { duration: 0.2 }
          }}
        />

        {/* 两端标签：模糊化展示 */}
        <div className="absolute inset-0 z-40 pointer-events-none flex justify-between items-center px-1">
          <div className="text-[9px] font-semibold text-red-600/80">空</div>
          <div className="text-[9px] font-semibold text-red-600/80">爆</div>
        </div>
      </div>
    </div>
  );
};

// 可滑动卡牌 (集成翻牌音效)
const SwipeCard = ({ card, showingResult, lastChoice, onSwipe, onPreviewChange, onFlipComplete }) => {
  const [frontPageIndex, setFrontPageIndex] = useState(0);
  const [backPageIndex, setBackPageIndex] = useState(0);

  const frontPages = React.useMemo(
    () => splitToPages(card?.description, { linesPerPage: DEFAULT_TEXT_PAGINATION.cardFrontPageLines }),
    [card]
  );
  const backPages = React.useMemo(
    () => splitToPages(lastChoice?.consequence, { linesPerPage: DEFAULT_TEXT_PAGINATION.cardBackPageLines }),
    [lastChoice]
  );

  useEffect(() => {
    // 切换卡牌时重置
    setFrontPageIndex(0);
    setBackPageIndex(0);
  }, [card?.id]);

  useEffect(() => {
    // 结果态开始时重置背面分页
    if (showingResult) setBackPageIndex(0);
  }, [showingResult]);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const [dragDir, setDragDir] = useState(null);
  const lastPreviewRef = useRef({ dir: null, progress: 0 });
  const hasPlayedRef = useRef(false);

  useEffect(() => {
    if (showingResult && !hasPlayedRef.current) {
      hasPlayedRef.current = true;
      playSfx('flip');
    }
    if (!showingResult) hasPlayedRef.current = false;
  }, [showingResult]);

  useEffect(() => {
    if (showingResult) {
      const t = setTimeout(onFlipComplete, 2000);
      return () => clearTimeout(t);
    }
  }, [showingResult, onFlipComplete]);

  const calcPreview = useCallback((offsetX) => {
    // 进入/退出方向的阈值（带回滞，避免边界抖动）
    const ENTER = 30;
    const EXIT = 15;
    const THRESHOLD = 80;
    const START = 20;

    let dir = lastPreviewRef.current.dir;
    if (dir === 'left' && offsetX > -EXIT) dir = null;
    if (dir === 'right' && offsetX < EXIT) dir = null;
    if (!dir) dir = offsetX > ENTER ? 'right' : offsetX < -ENTER ? 'left' : null;

    const absX = Math.abs(offsetX);
    const progress = dir ? Math.max(0, Math.min(1, (absX - START) / (THRESHOLD - START))) : 0;

    lastPreviewRef.current = { dir, progress };

    if (!dir) {
      onPreviewChange && onPreviewChange(null);
      return dir;
    }

    const choice = card.choices.find(c => c.id === dir);
    const effects = choice?.effects || { mianzi: 0, lizi: 0 };

    onPreviewChange && onPreviewChange({ dir, progress, effects });
    return dir;
  }, [card, onPreviewChange]);

  return (
    <div className="relative h-full flex flex-col px-10" style={{ perspective: '1000px' }}>
      <motion.div
        className="flex-1 relative"
        style={{ x: showingResult ? 0 : x, rotate: showingResult ? 0 : rotate, transformStyle: 'preserve-3d' }}
        drag={!showingResult ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        onDrag={(e, info) => {
          const dir = calcPreview(info.offset.x);
          setDragDir(dir);
        }}
        onDragEnd={(e, info) => {
          if (!showingResult && Math.abs(info.offset.x) > 80) onSwipe(info.offset.x > 0 ? 'right' : 'left');
          setDragDir(null);
          lastPreviewRef.current = { dir: null, progress: 0 };
          onPreviewChange && onPreviewChange(null);
        }}
        animate={{ rotateY: showingResult ? 180 : 0 }}
      >
        {/* 正面 */}
        <div className="absolute inset-0 bg-white border-2 border-gray-200 rounded-3xl overflow-hidden shadow-xl flex flex-col" style={{ backfaceVisibility: 'hidden' }}>
          <div className="h-2/5 bg-amber-50 flex items-center justify-center text-8xl relative">
            {card.emoji}
            {dragDir && <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4"><span className="text-white text-lg font-bold">{card.choices.find(c => c.id === dragDir)?.text}</span></div>}
          </div>
          <div 
            className="flex-1 p-5 flex flex-col cursor-pointer active:scale-[0.99] transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              if (frontPageIndex < frontPages.length - 1) {
                setFrontPageIndex(v => v + 1);
              } else {
                setFrontPageIndex(0);
              }
            }}
          >
            <h3 className="text-xl font-bold mb-3">{card.title}</h3>
            <div className="flex-1 relative">
              {renderRichText(frontPages[frontPageIndex], 'cardFront')}
              {frontPages.length > 1 && (
                <div className="absolute -bottom-2 left-0 right-0 flex justify-center gap-1">
                  {frontPages.map((_, i) => (
                    <div key={i} className={`w-1 h-1 rounded-full ${i === frontPageIndex ? 'bg-gray-400' : 'bg-gray-200'}`} />
                  ))}
                </div>
              )}
            </div>
            <div className="choice-container" role="group" aria-label="选择">
              <button
                type="button"
                disabled={showingResult}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showingResult) onSwipe('left');
                }}
                className={`choice-btn choice-btn-left ${dragDir === 'left' ? 'choice-active' : ''} ${showingResult ? 'choice-btn-disabled' : ''}`}
              >
                <span className="choice-btn-icon">←</span>
                <span className="choice-btn-text">选择：{card.choices.find(c=>c.id==='left')?.text}</span>
              </button>

              <button
                type="button"
                disabled={showingResult}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showingResult) onSwipe('right');
                }}
                className={`choice-btn choice-btn-right ${dragDir === 'right' ? 'choice-active' : ''} ${showingResult ? 'choice-btn-disabled' : ''}`}
              >
                <span className="choice-btn-text">选择：{card.choices.find(c=>c.id==='right')?.text}</span>
                <span className="choice-btn-icon">→</span>
              </button>
            </div>
          </div>
        </div>
        {/* 背面 */}
        <div className="absolute inset-0 bg-white border-2 border-gray-200 rounded-3xl p-6 shadow-xl flex flex-col overflow-hidden" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          {lastChoice && (
            <>
              {/* 背面：水印 emoji（来自 CARDS_POOL 的 card.emoji） */}
              <motion.div
                aria-hidden="true"
                className="absolute right-4 top-4 text-[72px] leading-none select-none pointer-events-none"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 0.10, scale: 1 }}
                transition={{ duration: 0.35 }}
              >
                {card?.emoji || ''}
              </motion.div>

              <div className="flex items-start justify-between gap-3 mb-3 relative z-10">
                <div className="bg-gray-900 text-white px-3 py-1 rounded-lg text-sm inline-block self-start">{lastChoice.text}</div>

                {/* 背面：徽章 emoji 轻动效 */}
                <motion.div
                  className="shrink-0 w-9 h-9 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center"
                  initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                >
                  <span className="text-xl leading-none">{card?.emoji || '✨'}</span>
                </motion.div>
              </div>

              {/* 本次变动概览（Δ）：数字 + 迷你条（红绿双色） */}
              <motion.div
                className="mb-3 grid grid-cols-2 gap-2 relative z-10"
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.25 }}
              >
                {(() => {
                  const m = Number(lastChoice.effects?.mianzi ?? 0);
                  const l = Number(lastChoice.effects?.lizi ?? 0);
                  const MAX = 30; // 认为 |30| 是“满格”变化，用于可视化，不影响实际逻辑
                  const mAbs = Math.min(1, Math.abs(m) / MAX);
                  const lAbs = Math.min(1, Math.abs(l) / MAX);

                  const MiniBar = ({ absRatio, positive }) => (
                    <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full ${positive ? 'bg-green-500' : 'bg-red-500'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.round(absRatio * 100)}%` }}
                        transition={{ duration: 0.35 }}
                      />
                    </div>
                  );

                  const getDegreeText = (val) => {
                    const abs = Math.abs(val);
                    if (abs === 0) return '无变化';
                    if (abs <= 5) return '微幅变动';
                    if (abs <= 12) return '有所增减';
                    return '大幅变动';
                  };

                  return (
                    <>
                      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                        <div className="text-[10px] text-gray-400 font-semibold">面子影响</div>
                        <div className={`text-sm font-black ${m >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {m > 0 ? '提升' : m < 0 ? '下降' : '持平'}{m !== 0 && ` (${getDegreeText(m)})`}
                        </div>
                        <MiniBar absRatio={mAbs} positive={m >= 0} />
                      </div>

                      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                        <div className="text-[10px] text-gray-400 font-semibold">里子影响</div>
                        <div className={`text-sm font-black ${l >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {l > 0 ? '提升' : l < 0 ? '下降' : '持平'}{l !== 0 && ` (${getDegreeText(l)})`}
                        </div>
                        <MiniBar absRatio={lAbs} positive={l >= 0} />
                      </div>
                    </>
                  );
                })()}
              </motion.div>

              <div
                className="text-gray-700 flex-1 cursor-pointer relative z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (backPageIndex < backPages.length - 1) {
                    setBackPageIndex(v => v + 1);
                  } else {
                    onFlipComplete();
                  }
                }}
              >
                {renderRichText(backPages[backPageIndex], 'cardBack')}
                {backPages.length > 1 && (
                  <div className="flex justify-center gap-1 mt-4">
                    {backPages.map((_, i) => (
                      <div key={i} className={`w-1 h-1 rounded-full ${i === backPageIndex ? 'bg-gray-400' : 'bg-gray-200'}`} />
                    ))}
                  </div>
                )}
              </div>

              {/* 底部收口，减少留白空洞感 */}
              <div className="relative z-10 mt-4">
                <div className="h-8 bg-gradient-to-t from-black/5 to-transparent rounded-xl" />
                <div className="-mt-6 text-center">
                  <span className="inline-block text-xs text-gray-400 px-3 py-1 rounded-full border border-gray-200 bg-white/80">点击继续</span>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

// 底部导航
const BottomNav = ({ activeTab, onTabChange, disabled }) => (
  <div className={`flex border-t bg-white ${disabled ? 'opacity-50' : ''}`}>
    {[
      { id: 'home', icon: '🏠', name: '主页' },
      { id: 'people', icon: '🧑', name: '人物' },
      { id: 'achievements', icon: '🏆', name: '成就' },
      { id: 'about', icon: '❓', name: '关于' }
    ].map(tab => (
      <button
        key={tab.id}
        onClick={() => !disabled && onTabChange(tab.id)}
        className={`nav-tab ${activeTab === tab.id ? 'nav-tab-active' : 'nav-tab-inactive'}`}
      >
        <span>{tab.icon} {tab.name}</span>
      </button>
    ))}
  </div>
);

// 游戏主板
const GameBoard = ({ state, onChoice, onNextRound, onTabChange, dispatch }) => {
  const [preview, setPreview] = useState(null);
  const [isMuted, setIsMuted] = useState(bgmAudio ? bgmAudio.muted : false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  
  const toggleMute = () => {
    if (bgmAudio) {
      const newMuted = !bgmAudio.muted;
      bgmAudio.muted = newMuted;
      setIsMuted(newMuted);
      // 如果是在静音状态下开启，尝试播放（处理浏览器拦截）
      if (!newMuted) {
        bgmAudio.play().catch(() => {});
      }
    }
  };

  const getLockInfo = (identity, savedData) => {
    let locked = false;
    let unlockHint = "";
    const successSet = new Set(savedData?.successfulIdentities || []);

    const hasJuanwangSuccess = successSet.has('juanwang');
    const hasTizhineiSuccess = successSet.has('tizhinei');
    const hasWaimaiSuccess = successSet.has('waimai');

    if (identity.id === 'waimai' && !(hasJuanwangSuccess || hasTizhineiSuccess)) {
      locked = true;
      unlockHint = "大厂卷王/体制内青年任意一个达成成功结局解锁";
    } else if (identity.id === 'fuerdai' && !(hasJuanwangSuccess && hasTizhineiSuccess && hasWaimaiSuccess)) {
      locked = true;
      unlockHint = "分享一次即可解锁";
    } else if (identity.id === 'qitingzhang' && successSet.size < 3) {
      locked = true;
      unlockHint = "成功通关任意3个角色即可开启爽局";
    }

    if (locked && identity.id === 'fuerdai' && Array.isArray(savedData?.sharedUnlocks) && savedData.sharedUnlocks.includes('fuerdai')) {
      locked = false;
      unlockHint = "";
    }

    return { locked, unlockHint };
  };

  const previewEffects = preview?.effects || { mianzi: 0, lizi: 0 };
  const previewProgress = preview?.progress || 0;
  if (state.activeTab !== 'home') {
    return (
      <div className="flex flex-col h-screen bg-white overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {state.activeTab === 'people' && <PeopleTab savedData={state.savedData} />}
          {state.activeTab === 'achievements' && (
            <div className="h-full flex flex-col min-h-0 overflow-hidden -m-6">
              <AchievementsTab
                savedData={state.savedData}
                onBack={() => onTabChange('home')}
                defaultFilter={state.achievementsDefaultFilter || 'locked'}
              />
            </div>
          )}
          {state.activeTab === 'about' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="bg-[#fffcf5] border border-amber-100 rounded-2xl p-6 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-amber-100/30 to-transparent rounded-bl-full pointer-events-none" />

                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-[2px] bg-amber-200"></span>
                  <div className="text-[13px] font-black text-amber-800 tracking-[0.2em]">一封春节的信</div>
                </div>

                <div className="text-[15px] text-amber-950 leading-8 space-y-4 font-medium">
                  <p className="text-lg font-bold text-amber-900">见字如面。</p>
                  <p className="indent-8 text-justify">又是一年春节。无论你此刻是在回家的路上，还是已经坐在饭桌边，愿你先把自己的呼吸放慢一点：<span className="text-rose-700">别急着证明自己，也别急着把所有人的期待都扛在肩上。</span></p>
                  <p className="indent-8 text-justify">如果这一年你收获很多，愿你把好运分一点给身边的人；如果这一年你走得很累，愿你允许自己“够了就好”。热闹可以尽兴，沉默也可以体面。</p>
                  <p className="indent-8 text-justify">愿你在新的一年里，既能把日子过得有光，也能把心事放得更轻。愿你总能在面子与里子之间，找到属于自己的分寸与温柔。</p>

                  <div className="pt-4 border-t border-amber-100/50 mt-6 flex flex-col items-end">
                    <p className="text-amber-800 text-base font-black">新春快乐，万事顺意。</p>
                    <p className="text-amber-600/60 text-[10px] mt-1 font-normal italic">——TONY</p>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 px-2">
                <span className="text-amber-400 mt-0.5">💡</span>
                <div className="text-[12px] text-gray-400 leading-relaxed italic">
                  提示：左右滑动卡牌进行决策。在“面子”的社会期待与“里子”的内心真实间，寻找属于你的平衡。
                </div>
              </div>
            </motion.div>
          )}
        </div>
        <div className="shrink-0 bg-white border-t">
          <button onClick={() => onTabChange('home')} className="w-[calc(100%-3rem)] mx-6 mt-4 mb-4 py-3 bg-gray-100 rounded-xl text-sm font-bold">返回游戏</button>
          <BottomNav activeTab={state.activeTab} onTabChange={onTabChange} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-screen bg-white relative overflow-hidden">
      <div className="px-4 py-3 border-b flex justify-between items-center text-xs relative z-10">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-gray-400 shrink-0">身份</p>
          <p className="font-bold text-sm truncate">{state.identity.emoji} {state.identity.name}</p>
          <button 
            onClick={() => setIsDrawerOpen(true)}
            className="identity-switch-btn"
            title="切换身份"
          >
            ⇄
          </button>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-center"><p className="text-gray-400">当前</p><p className="font-bold">{GAME_CONFIG.dayNames[state.day]}</p></div>
          <div className="text-right"><p className="text-gray-400">距离返工</p><p className="font-bold">{GAME_CONFIG.totalDays - state.day + 1}天</p></div>
        </div>
      </div>

      <AnimatePresence>
        {isDrawerOpen && (
          <>
            <motion.div 
              className="identity-drawer-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
            />
            <motion.div 
              className="identity-drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <div className="identity-drawer-header">
                <div className="identity-drawer-title">切换身份</div>
                <div className="identity-drawer-subtitle">选择新身份重新开始春节冒险，当前进度将不被保留。</div>
                <button className="identity-drawer-close" onClick={() => setIsDrawerOpen(false)}>×</button>
              </div>
              <div className="identity-drawer-list no-scrollbar">
                {IDENTITIES.map(identity => {
                  const { locked, unlockHint } = getLockInfo(identity, state.savedData);
                  const isCurrent = state.identity.id === identity.id;
                  
                  return (
                    <button 
                      key={identity.id}
                      className={`identity-item ${isCurrent ? 'identity-item-current' : ''} ${locked ? 'identity-item-locked' : ''}`}
                      onClick={() => {
                        if (locked || isCurrent) return;
                        setConfirmTarget(identity);
                      }}
                    >
                      <div className="identity-item-emoji">{identity.emoji}</div>
                      <div className="identity-item-main">
                        <div className="identity-item-name">{identity.name}</div>
                        <div className="identity-item-meta">
                          {locked ? unlockHint : identity.subtitle}
                        </div>
                      </div>
                      <div className={`identity-item-cta ${locked ? 'identity-item-cta-disabled' : ''}`}>
                        {isCurrent ? '当前' : locked ? '未解锁' : '切换'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmTarget && (
          <motion.div 
            className="confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="confirm-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="confirm-modal-body">
                <div className="confirm-title">确认切换到【{confirmTarget.name}】？</div>
                <div className="confirm-desc">切换身份后，当前第 {state.day} 天的进度将重置，您将以新身份重新开始第一天的故事。</div>
              </div>
              <div className="confirm-actions">
                <button className="confirm-btn" onClick={() => setConfirmTarget(null)}>取消</button>
                <button 
                  className="confirm-btn confirm-btn-primary"
                  onClick={() => {
                    dispatch({ type: 'CONFIRM_IDENTITY', payload: confirmTarget.id });
                    setConfirmTarget(null);
                    setIsDrawerOpen(false);
                  }}
                >
                  确认切换并播放开场
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="p-4 bg-gray-50 flex gap-4">
        <StatBar label="面子" value={state.stats.mianzi} previewEffect={previewEffects.mianzi} previewProgress={previewProgress} />
        <StatBar label="里子" value={state.stats.lizi} previewEffect={previewEffects.lizi} previewProgress={previewProgress} />
      </div>

      <div className="px-8 py-2 flex justify-center relative">
        <div className="flex gap-2 w-32">
          {Array.from({ length: GAME_CONFIG.roundsPerDay }).map((_, i) => {
            const isPast = i + 1 < state.round;
            const isCurrent = i + 1 === state.round;
            return (
              <motion.div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${isPast ? 'bg-gray-300' : isCurrent ? 'bg-slate-200' : 'bg-gray-100'}`}
                animate={isCurrent ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
                transition={isCurrent ? { duration: 1.6, repeat: Infinity } : { duration: 0.2 }}
              />
            );
          })}
        </div>
        
        {/* 音量控制按钮 */}
        <button 
          onClick={toggleMute}
          className="absolute right-8 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 border border-gray-100 shadow-sm active:scale-90 transition-transform"
        >
          <span className="text-base">{isMuted ? '🔇' : '🔊'}</span>
        </button>
      </div>

      <div className="flex-1 py-4">
        <SwipeCard 
          card={state.currentCard} 
          showingResult={state.showingResult} 
          lastChoice={state.lastChoice} 
          onSwipe={onChoice} 
          onPreviewChange={setPreview} 
          onFlipComplete={onNextRound} 
        />
      </div>
      <BottomNav activeTab={state.activeTab} onTabChange={onTabChange} disabled={state.showingResult} />
    </div>
  );
};

// 每日总结
const DaySummary = ({ state, onNextDay }) => {
  const deltaM = state.stats.mianzi - state.dayStartStats.mianzi;
  const deltaL = state.stats.lizi - state.dayStartStats.lizi;

  const renderTrend = (label, delta) => {
    const isNoChange = Math.abs(delta) <= 5;
    const isLarge = Math.abs(delta) >= 15;
    const isIncreasing = delta > 5;

    return (
      <div className="flex items-center justify-between py-4 border-b border-white/5 last:border-0">
        <span className="text-sm font-medium text-white/50 tracking-wider">{label}</span>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 min-w-[40px] justify-end">
            {isNoChange ? (
              <span className="text-white/20 text-xs tracking-widest">—</span>
            ) : (
              <span className={`text-xs font-black ${isIncreasing ? 'text-emerald-400' : 'text-rose-400'} drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]`}>
                {isIncreasing ? (isLarge ? '▲▲' : '▲') : (isLarge ? '▼▼' : '▼')}
              </span>
            )}
          </div>
          <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
            {!isNoChange && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: isLarge ? '100%' : '50%', opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className={`h-full rounded-full ${isIncreasing ? 'bg-gradient-to-r from-emerald-500/20 to-emerald-400' : 'bg-gradient-to-r from-rose-500/20 to-rose-400'}`}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <motion.div 
      className="flex flex-col h-screen px-6 py-10 overflow-hidden summary-page-bg text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <motion.div 
          className="text-7xl mb-8 filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.3)]"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          {GAME_CONFIG.dayEmoji[state.day]}
        </motion.div>
        
        <h2 className="text-2xl font-black mb-10 tracking-[0.2em] text-white/90">
          {GAME_CONFIG.dayNames[state.day]} <span className="text-white/30 font-light ml-2">回顾</span>
        </h2>

        <motion.div 
          className="relative w-full mb-12"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="absolute -top-6 -left-2 text-6xl text-white/5 font-serif">“</div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10">
            <p className="text-lg leading-relaxed text-white/90 italic font-medium text-center">
              {GAME_CONFIG.dayQuotes[state.day]}
            </p>
          </div>
          <div className="absolute -bottom-10 -right-2 text-6xl text-white/5 font-serif">”</div>
        </motion.div>
        
        <motion.div 
          className="bg-white/5 backdrop-blur-md border border-white/10 w-full rounded-3xl p-6 shadow-xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-[10px] font-black text-white/30 tracking-[0.3em] uppercase">今日变动指标</span>
            <div className="h-px flex-1 bg-white/10 ml-4" />
          </div>
          {renderTrend('面子指数', deltaM)}
          {renderTrend('里子内耗', deltaL)}
        </motion.div>
      </div>

      <motion.button 
        onClick={onNextDay} 
        className="w-full max-w-sm mx-auto py-4 bg-white text-gray-900 rounded-2xl font-black text-base shadow-[0_10px_30px_rgba(255,255,255,0.1)] active:scale-[0.98] transition-transform"
        whileTap={{ scale: 0.98 }}
      >
        开启新篇章
      </motion.button>
    </motion.div>
  );
};

// 过渡
const DayTransition = ({ day, onContinue }) => {
  useEffect(() => {
    const t = setTimeout(onContinue, 2500);
    return () => clearTimeout(t);
  }, [onContinue]);

  return (
    <motion.div 
      className="flex flex-col items-center justify-center h-screen overflow-hidden transition-page-bg cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onContinue}
    >
      <motion.div 
        className="text-8xl mb-10 filter drop-shadow-[0_20px_40px_rgba(0,0,0,0.4)]"
        initial={{ scale: 0.8, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
      >
        {GAME_CONFIG.dayEmoji[day]}
      </motion.div>

      <div className="relative flex flex-col items-center">
        <motion.h1 
          className="text-4xl font-black text-white tracking-[0.4em] mb-4"
          initial={{ letterSpacing: "0.2em", opacity: 0 }}
          animate={{ letterSpacing: "0.4em", opacity: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        >
          {GAME_CONFIG.dayNames[day]}
        </motion.h1>

        {GAME_CONFIG.dayThemes && GAME_CONFIG.dayThemes[day] && (
          <motion.div 
            className="flex items-center gap-4 text-white/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <div className="w-8 h-px bg-white/20" />
            <span className="text-sm font-light tracking-[0.5em] uppercase">{GAME_CONFIG.dayThemes[day]}</span>
            <div className="w-8 h-px bg-white/20" />
          </motion.div>
        )}
      </div>

      <motion.div 
        className="absolute bottom-16 text-white/20 text-[10px] tracking-[0.3em] uppercase font-light"
        animate={{ opacity: [0.2, 0.5, 0.2] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        点击任意位置跳过
      </motion.div>
    </motion.div>
  );
};

// 失败页 (集成音效)
const FailureScreen = ({ failure, state, onRestart, onSwitchIdentity }) => {
  useEffect(() => { playSfx('loss'); }, []);

  const getReason = () => {
    const { mianzi, lizi } = state.stats;
    if (mianzi <= 0) return '面子归零';
    if (mianzi >= 100) return '面子爆满';
    if (lizi <= 0) return '里子归零';
    if (lizi >= 100) return '里子爆满';
    return null;
  };

  const reason = getReason();

  const savedData = state.savedData || {};
  const totalIdentities = IDENTITIES.length;
  const successCount = new Set(savedData.successfulIdentities || []).size;
  const totalAchievements = ACHIEVEMENTS.length;
  const achievementsUnlocked = new Set(
    (savedData.unlockedAchievements || [])
      .map(x => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
  ).size;
  const totalEndings = Object.values(ENDINGS_BY_IDENTITY).reduce((s, i) => s + (i.normal ? Object.keys(i.normal).length : 0), 0);
  const endingsUnlocked = new Set(savedData.unlockedEndings || []).size;


  const storyPages = React.useMemo(
    () => splitToPages(failure?.text, { linesPerPage: 14 }),
    [failure?.text]
  );
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex(0);
  }, [failure?.title, failure?.text]);

  return (
    <div className="flex flex-col h-screen px-5 py-6 text-white overflow-hidden failure-share-bg">
      <div className="relative mx-auto w-full max-w-md flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 pt-1">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
            <span className="text-[11px] tracking-[0.25em] font-black text-white/90">挑战失败</span>
          </div>
        </div>

        <div className="shrink-0 mt-4 flex items-start gap-3">
          <div className="text-5xl leading-none">{failure.emoji}</div>
          <div className="min-w-0 flex-1">
            <div className="text-[22px] leading-7 font-black tracking-wide">{failure.title}</div>
            {reason && (
              <div className="mt-2 inline-flex items-center px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-400/20">
                <span className="text-[11px] text-rose-100/90 font-bold">{reason}</span>
              </div>
            )}
          </div>
        </div>

        <div
          className="ending-content-card flex-1 min-h-0 mt-4 rounded-3xl border border-white/10 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] cursor-pointer active:scale-[0.995] transition-transform"
          style={{ 
            background: 'rgba(0, 0, 0, 0.7)', 
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.15)' 
          }}
          onClick={() => {
            if (storyPages.length <= 1) return;
            if (pageIndex < storyPages.length - 1) setPageIndex(v => v + 1);
            else setPageIndex(0);
          }}
        >
          <div 
            className="ending-text-readable text-[14px] leading-8"
            style={{ 
              color: '#ffffff', 
              textShadow: '0 2px 4px rgba(0,0,0,0.5)',
              fontWeight: '500'
            }}
          >
            {renderRichText(storyPages[pageIndex], 'failure')}
          </div>

          {storyPages.length > 1 && (
            <div className="mt-3 flex items-center justify-between text-[10px] text-white/45">
              <div>轻点翻页</div>
              <div>{pageIndex + 1} / {storyPages.length}</div>
            </div>
          )}
        </div>

        <div className="shrink-0 mt-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-black/15 border border-white/10 px-3 py-2">
              <div className="text-[10px] text-white/45 font-black tracking-widest">身份</div>
              <div className="mt-1 text-[14px] font-black text-white/85">{successCount}/{totalIdentities}</div>
            </div>
            <div className="rounded-xl bg-black/15 border border-white/10 px-3 py-2">
              <div className="text-[10px] text-white/45 font-black tracking-widest">成就</div>
              <div className="mt-1 text-[14px] font-black text-white/85">{achievementsUnlocked}/{totalAchievements}</div>
            </div>
            <div className="rounded-xl bg-black/15 border border-white/10 px-3 py-2">
              <div className="text-[10px] text-white/45 font-black tracking-widest">结局</div>
              <div className="mt-1 text-[14px] font-black text-white/85">{endingsUnlocked}/{totalEndings}</div>
            </div>
          </div>
        </div>

        <div className="shrink-0 mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={onRestart}
            className="py-3 rounded-2xl bg-white text-gray-900 font-black text-sm shadow-lg active:scale-[0.99]"
          >
            重新开始
          </button>
          <button
            onClick={onSwitchIdentity}
            className="py-3 rounded-2xl bg-rose-500 text-white font-black text-sm shadow-lg active:scale-[0.99]"
          >
            换个身份
          </button>
        </div>

        <div className="shrink-0 mt-4 pb-1 flex items-center justify-between text-[10px] text-white/35">
          <div>《{GAME_CONFIG.title}》· 失败结局卡</div>
          <div>{new Date().toLocaleDateString('zh-CN')}</div>
        </div>
      </div>
    </div>
  );
};

// 结局页 (集成音效 & 进度展示)
const EndingScreen = ({ state, onRestart }) => {
  const { ending, savedData } = state;
  useEffect(() => { playSfx('success'); }, []);

  const totalIdentities = IDENTITIES.length;
  const successCount = new Set(savedData.successfulIdentities || []).size;
  const totalAchievements = ACHIEVEMENTS.length;
  const achievementsUnlocked = new Set(
    (savedData.unlockedAchievements || [])
      .map(x => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
  ).size;
  const totalEndings = Object.values(ENDINGS_BY_IDENTITY).reduce((s, i) => s + (i.normal ? Object.keys(i.normal).length : 0), 0);
  const endingsUnlocked = new Set(savedData.unlockedEndings || []).size;



  const storyPages = React.useMemo(
    () => splitToPages(ending?.text, { linesPerPage: 14 }),
    [ending?.text]
  );
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex(0);
  }, [ending?.name, ending?.text]);

  return (
    <div className="relative flex flex-col h-screen px-5 py-6 overflow-hidden success-share-bg text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute -bottom-28 left-8 h-72 w-72 rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
      </div>
      <div className="mx-auto w-full max-w-md flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 pt-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-400/25 to-amber-200/10 border border-amber-300/25 backdrop-blur-sm shadow-[0_10px_26px_rgba(245,158,11,0.12)]">
            <span className="text-[11px] tracking-[0.25em] font-black text-white">通关成功</span>
          </div>
        </div>

        <div className="shrink-0 mt-4 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <div className="flex items-start gap-3">
            <div className="text-5xl leading-none drop-shadow-[0_10px_20px_rgba(0,0,0,0.35)]">{ending.emoji}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[22px] leading-7 font-black tracking-wide text-white drop-shadow-[0_10px_24px_rgba(0,0,0,0.4)]">{ending.name}</div>
              <div className="mt-1 text-[11px] text-white/60 font-black tracking-[0.25em]">{state.identity?.name}</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="relative overflow-hidden rounded-2xl bg-black/15 border border-white/10 px-3 py-3 text-center">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
              <div className="relative text-[10px] text-white/45 font-black tracking-widest">面子</div>
              <div className="relative mt-1 text-[30px] leading-none font-black text-white">{state.stats?.mianzi}</div>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-black/15 border border-white/10 px-3 py-3 text-center">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
              <div className="relative text-[10px] text-white/45 font-black tracking-widest">里子</div>
              <div className="relative mt-1 text-[30px] leading-none font-black text-white">{state.stats?.lizi}</div>
            </div>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 mt-3 rounded-3xl border border-white/10 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] cursor-pointer active:scale-[0.995] transition-transform ending-content-card"
          style={{ WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 86%, rgba(0,0,0,0))' }}
          onClick={() => {
            if (storyPages.length <= 1) return;
            if (pageIndex < storyPages.length - 1) setPageIndex(v => v + 1);
            else setPageIndex(0);
          }}
        >
          <div className="ending-text-readable">
            {renderRichText(storyPages[pageIndex], 'ending')}
          </div>

          {storyPages.length > 1 && (
            <div className="mt-3 flex items-center justify-between text-[10px] text-white/45">
              <div>轻点翻页</div>
              <div>{pageIndex + 1} / {storyPages.length}</div>
            </div>
          )}
        </div>

        <div className="shrink-0 mt-3 space-y-3">
          {ending.unlockNotice && (
            <div className="p-3 bg-white/10 border border-white/15 rounded-2xl text-amber-100/90 text-[11px] font-bold leading-5 shadow-sm">
              ✨ {ending.unlockNotice}
            </div>
          )}
          
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-black/15 border border-white/10 px-3 py-2 text-center">
                <div className="text-[10px] text-white/45 font-black tracking-widest">身份</div>
                <div className="mt-1 text-[14px] font-black text-white/85">{successCount}/{totalIdentities}</div>
              </div>
              <div className="rounded-xl bg-black/15 border border-white/10 px-3 py-2 text-center">
                <div className="text-[10px] text-white/45 font-black tracking-widest">成就</div>
                <div className="mt-1 text-[14px] font-black text-white/85">{achievementsUnlocked}/{totalAchievements}</div>
              </div>
              <div className="rounded-xl bg-black/15 border border-white/10 px-3 py-2 text-center">
                <div className="text-[10px] text-white/45 font-black tracking-widest">结局</div>
                <div className="mt-1 text-[14px] font-black text-white/85">{endingsUnlocked}/{totalEndings}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 mt-3">
          <button
            onClick={onRestart}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-black text-base shadow-[0_8px_20px_rgba(245,158,11,0.3)] active:scale-[0.98] transition-all"
          >
            再次挑战
          </button>
        </div>

        <div className="shrink-0 mt-4 pb-1 flex items-center justify-between text-[10px] text-white/20 font-medium tracking-tight">
          <div className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-white/20" />
            《{GAME_CONFIG.title}》· 通关纪念卡
          </div>
          <div>{new Date().toLocaleDateString('zh-CN')}</div>
        </div>
      </div>
    </div>
  );
};

// App
function App() {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  useEffect(() => {
    if (!bgmAudio) return;

    if (state.phase === 'playing' || state.phase === 'daySummary' || state.phase === 'transition') {
      bgmAudio.play().catch(() => {});
    } else {
      bgmAudio.pause();
    }
  }, [state.phase]);

  useEffect(() => {
    if (!bgmAudio) return;

    const unlock = () => {
      if (state.phase === 'playing') {
        bgmAudio.play().catch(() => {});
      }
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, [state.phase]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const from = url.searchParams.get('from');
      if (from === 'share') {
        const key = 'spring_festival_share_welcome_shown';
        if (localStorage.getItem(key) !== 'true') {
          localStorage.setItem(key, 'true');
          alert('欢迎！你是从朋友分享进来的，祝你春节顺利，打出一个好结局！');
        }
      }
    } catch (e) {}
  }, []);

  const [devOpen, setDevOpen] = useState(false);
  const devEnabled = isDevMode();
  const [devIdentityId, setDevIdentityId] = useState('juanwang');
  const [devEndingId, setDevEndingId] = useState('perfect_balance');
  const [devFailureId, setDevFailureId] = useState('mianzi_zero');
  const [devGotoPhase, setDevGotoPhase] = useState('start');
  const [devGotoDay, setDevGotoDay] = useState(1);
  const [devGotoRound, setDevGotoRound] = useState(1);
  const [devMianzi, setDevMianzi] = useState(50);
  const [devLizi, setDevLizi] = useState(50);

  return (
    <div className="h-screen bg-white overflow-hidden">
      {devEnabled && (
        <div className="fixed top-3 right-3 z-50 text-left">
          <button
            type="button"
            onClick={() => setDevOpen(v => !v)}
            className="px-3 py-1.5 rounded-xl bg-black/80 text-white text-xs font-bold shadow-lg"
          >
            {devOpen ? '关闭面板' : 'DEV 测试工具'}
          </button>

          {devOpen && (
            <div className="mt-2 w-[280px] max-h-[85vh] overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-2xl p-4 custom-scrollbar">
              <div className="flex items-center justify-between mb-4 pb-2 border-b">
                <div className="text-sm font-black text-gray-900">测试工具箱</div>
                <div className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded">选项1模式</div>
              </div>

              {/* 区块 1: 快捷场景 */}
              <div className="mb-4">
                <div className="text-[10px] font-black text-gray-400 tracking-widest mb-2 uppercase">快捷场景 (写入存档)</div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="bg-gray-50 p-2 rounded-xl">
                    <label className="block text-[10px] text-gray-500 mb-1">选择身份</label>
                    <select
                      className="w-full text-xs border-none bg-white rounded-lg px-2 py-1.5 shadow-sm"
                      value={devIdentityId}
                      onChange={(e) => setDevIdentityId(e.target.value)}
                    >
                      {IDENTITIES.map(i => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({
                          type: 'DEV_FORCE_ENDING',
                          payload: {
                            identityId: devIdentityId,
                            endingId: 'perfect_balance',
                            stats: { mianzi: 50, lizi: 50 }
                          }
                        });
                        setDevOpen(false);
                      }}
                      className="flex-1 py-2 rounded-lg bg-emerald-500 text-white font-bold text-[11px] shadow-sm active:scale-95 transition-transform"
                    >
                      一键成功 (平衡)
                    </button>
                  </div>

                  <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-100">
                    <label className="block text-[10px] text-gray-500 mb-1">失败类型</label>
                    <select
                      className="w-full text-xs border-none bg-gray-50 rounded-lg px-2 py-1.5"
                      value={devFailureId}
                      onChange={(e) => setDevFailureId(e.target.value)}
                    >
                      <option value="mianzi_zero">面子归零（mianzi_zero）</option>
                      <option value="mianzi_max">面子爆满（mianzi_max）</option>
                      <option value="lizi_zero">里子归零（lizi_zero）</option>
                      <option value="lizi_max">里子爆满（lizi_max）</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        dispatch({
                          type: 'DEV_FORCE_FAILURE',
                          payload: {
                            identityId: devIdentityId,
                            failureId: devFailureId
                          }
                        });
                        setDevOpen(false);
                      }}
                      className="w-full mt-2 py-2 rounded-lg bg-rose-500 text-white font-bold text-[11px] shadow-sm active:scale-95 transition-transform"
                    >
                      生成失败结局
                    </button>
                  </div>
                </div>
              </div>

              {/* 区块 2: 精细跳转 */}
              <div className="mb-4">
                <div className="text-[10px] font-black text-gray-400 tracking-widest mb-2 uppercase">精细页面跳转</div>
                <div className="bg-gray-50 p-3 rounded-xl space-y-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">目标 Phase</label>
                    <select
                      className="w-full text-xs border-none bg-white rounded-lg px-2 py-1.5 shadow-sm"
                      value={devGotoPhase}
                      onChange={(e) => setDevGotoPhase(e.target.value)}
                    >
                      <option value="start">start (封面)</option>
                      <option value="tutorial">tutorial (教程)</option>
                      <option value="identity">identity (选人)</option>
                      <option value="intro">intro (开场视频)</option>
                      <option value="playing">playing (游戏主画面)</option>
                      <option value="daySummary">daySummary (总结页)</option>
                      <option value="transition">transition (过场)</option>
                    </select>
                  </div>

                  {devGotoPhase === 'playing' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Day</label>
                        <input
                          type="number" min="1" max="7"
                          className="w-full text-xs border-none bg-white rounded-lg px-2 py-1.5 shadow-sm"
                          value={devGotoDay}
                          onChange={(e) => setDevGotoDay(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Round</label>
                        <input
                          type="number" min="1" max="3"
                          className="w-full text-xs border-none bg-white rounded-lg px-2 py-1.5 shadow-sm"
                          value={devGotoRound}
                          onChange={(e) => setDevGotoRound(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">面子</label>
                      <input
                        type="number" min="0" max="100"
                        className="w-full text-xs border-none bg-white rounded-lg px-2 py-1.5 shadow-sm"
                        value={devMianzi}
                        onChange={(e) => setDevMianzi(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">里子</label>
                      <input
                        type="number" min="0" max="100"
                        className="w-full text-xs border-none bg-white rounded-lg px-2 py-1.5 shadow-sm"
                        value={devLizi}
                        onChange={(e) => setDevLizi(e.target.value)}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      dispatch({
                        type: 'DEV_GOTO',
                        payload: {
                          phase: devGotoPhase,
                          identityId: devIdentityId,
                          day: devGotoDay,
                          round: devGotoRound,
                          stats: { mianzi: Number(devMianzi), lizi: Number(devLizi) }
                        }
                      });
                      setDevOpen(false);
                    }}
                    className="w-full py-2 rounded-lg bg-gray-900 text-white font-bold text-xs shadow-sm mt-1"
                  >
                    执行跳转
                  </button>
                </div>
              </div>

              {/* 区块 3: 存档管理 */}
              <div className="mb-4">
                <div className="text-[10px] font-black text-gray-400 tracking-widest mb-2 uppercase">数据管理</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('确定要清空所有存档（包括解锁、成就）并重启吗？')) {
                        localStorage.removeItem(STORAGE_KEY);
                        localStorage.removeItem('spring_festival_share_welcome_shown');
                        location.reload();
                      }
                    }}
                    className="py-2 rounded-lg bg-red-100 text-red-700 font-bold text-[10px] border border-red-200"
                  >
                    彻底清档重启
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: 'BACK_TO_IDENTITY' });
                      setDevOpen(false);
                    }}
                    className="py-2 rounded-lg bg-gray-100 text-gray-700 font-bold text-[10px] border border-gray-200"
                  >
                    回选人页
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem(DEV_MODE_KEY, 'false');
                    setDevOpen(false);
                  }}
                  className="w-full py-2 rounded-xl bg-gray-200 text-gray-600 font-bold text-[11px]"
                >
                  完全禁用 DEV 模式
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <AnimatePresence mode="wait">
        {state.phase === 'start' && <StartScreen key="start" onStart={() => dispatch({ type: 'START_GAME' })} />}
        {state.phase === 'tutorial' && <TutorialScreen key="tutorial" onComplete={() => dispatch({ type: 'TUTORIAL_DONE' })} />}
        {state.phase === 'identity' && (
          <IdentitySelect
            key="identity"
            selectedId={state.selectedIdentityId}
            onSelect={(id) => dispatch({ type: 'SELECT_IDENTITY', payload: id })}
            onConfirm={(id) => dispatch({ type: 'CONFIRM_IDENTITY', payload: id })}
            savedData={state.savedData}
            onShareUnlock={(identityId) => {
              const url = new URL(window.location.href);
              url.searchParams.set('from', 'share');

              const identityNameMap = {
                juanwang: '大厂卷王',
                tizhinei: '体制内青年',
                waimai: '外卖骑手',
                fuerdai: '家族继承人'
              };

              const shareText = `我在玩《${GAME_CONFIG.title}》，来挑战一下你的春节结局吧！\n\n点开开始：${url.toString()}`;

              const finishUnlock = () => {
                const newSavedData = { ...state.savedData };
                if (!Array.isArray(newSavedData.sharedUnlocks)) newSavedData.sharedUnlocks = [];
                if (!newSavedData.sharedUnlocks.includes(identityId)) {
                  newSavedData.sharedUnlocks = [...newSavedData.sharedUnlocks, identityId];
                }
                saveData(newSavedData);
                dispatch({ type: 'RESTART' });
              };

              const tryCopy = async () => {
                try {
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(shareText);
                    alert(`分享文案已复制到剪贴板！\n\n去微信/QQ群粘贴发送后，即可解锁【${identityNameMap[identityId] || identityId}】。`);
                    finishUnlock();
                    return;
                  }
                } catch (e) {}

                try {
                  const ta = document.createElement('textarea');
                  ta.value = shareText;
                  ta.setAttribute('readonly', '');
                  ta.style.position = 'fixed';
                  ta.style.opacity = '0';
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand('copy');
                  document.body.removeChild(ta);
                  alert(`分享文案已复制到剪贴板！\n\n去微信/QQ群粘贴发送后，即可解锁【${identityNameMap[identityId] || identityId}】。`);
                  finishUnlock();
                } catch (e) {
                  alert(`复制失败，请手动复制以下内容后分享：\n\n${shareText}`);
                  finishUnlock();
                }
              };

              tryCopy();
            }}
          />
        )}
        {state.phase === 'intro' && (
          <OpeningVideo
            key="intro"
            identity={state.identity}
            onComplete={() => dispatch({ type: 'START_PLAYING' })}
          />
        )}
        {state.phase === 'playing' && <GameBoard key="playing" state={state} dispatch={dispatch} onChoice={(id) => dispatch({ type: 'MAKE_CHOICE', payload: id })} onNextRound={() => dispatch({ type: 'NEXT_ROUND' })} onTabChange={(tab) => dispatch({ type: 'SET_TAB', payload: tab })} />}
        {state.phase === 'daySummary' && <DaySummary key="daySummary" state={state} onNextDay={() => dispatch({ type: 'NEXT_DAY' })} />}
        {state.phase === 'transition' && <DayTransition key="transition" day={state.day} onContinue={() => dispatch({ type: 'CONTINUE_DAY' })} />}
        {state.phase === 'failure' && (
          <FailureScreen
            key="failure"
            failure={state.failure}
            state={state}
            onRestart={() => dispatch({ type: 'RESTART' })}
            onSwitchIdentity={() => dispatch({ type: 'BACK_TO_IDENTITY' })}
          />
        )}
        {state.phase === 'ending' && <EndingScreen key="ending" state={state} onRestart={() => dispatch({ type: 'RESTART' })} />}
      </AnimatePresence>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
