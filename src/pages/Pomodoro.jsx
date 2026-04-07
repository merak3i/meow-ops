import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, SkipForward, RotateCcw, Settings } from 'lucide-react';
import TimerRing from '../components/pomodoro/TimerRing';
import CatBreedSprite from '../components/pomodoro/CatBreedSprite';
import PomodoroSettings from '../components/pomodoro/PomodoroSettings';
import PomodoroStats from '../components/pomodoro/PomodoroStats';
import {
  PHASES, CAT_BREEDS,
  getSettings, saveSettings,
  addSession, getTodayStats,
  pickRandomBreed, getUnlockedBreeds,
  createChimeSound, checkShinyDrop, addShiny,
} from '../lib/pomodoro-store';

function ParticleCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animId;
    const particles = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        r: Math.random() * 1.5 + 0.5,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.15,
        opacity: Math.random() * 0.06 + 0.02,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.offsetWidth;
        if (p.x > canvas.offsetWidth) p.x = 0;
        if (p.y < 0) p.y = canvas.offsetHeight;
        if (p.y > canvas.offsetHeight) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}

function ShinyDropOverlay({ shinyDrop, onDismiss }) {
  if (!shinyDrop) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300,
        cursor: 'pointer',
      }}
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="card"
        style={{ padding: 32, textAlign: 'center', maxWidth: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{ marginBottom: 16 }}
        >
          <CatBreedSprite breedKey={shinyDrop.breed} growthProgress={1} shinyVariant={shinyDrop.variant} />
        </motion.div>
        <div style={{ fontSize: 18, fontWeight: 300, marginBottom: 8, color: shinyDrop.glow }}>
          Shiny Drop!
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
          {shinyDrop.label} {shinyDrop.breedLabel}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Earned through {shinyDrop.streakReq}+ day streak
        </div>
        <button
          onClick={onDismiss}
          style={{
            marginTop: 16, padding: '8px 24px',
            background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: 8,
            cursor: 'pointer', fontSize: 13,
            fontFamily: 'inherit',
          }}
        >
          Collect
        </button>
      </motion.div>
    </motion.div>
  );
}

function PhaseDots({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: 8, height: 8,
            borderRadius: '50%',
            background: i < current ? 'var(--accent)' : i === current ? 'var(--accent)' : 'var(--bg-accent)',
            opacity: i === current ? 1 : i < current ? 0.5 : 0.3,
            transition: 'all 0.3s var(--ease)',
          }}
        />
      ))}
    </div>
  );
}

function ControlButton({ icon: Icon, onClick, primary, size = 48 }) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      style={{
        width: size, height: size,
        borderRadius: '50%',
        border: primary ? 'none' : '1px solid var(--border)',
        background: primary ? 'var(--accent)' : 'var(--bg-card)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon size={size === 48 ? 20 : 16} />
    </motion.button>
  );
}

export default function Pomodoro() {
  const [settings, setSettings] = useState(getSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState(PHASES.WORK);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(() => getSettings().workMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [currentBreed, setCurrentBreed] = useState(null);
  const [catState, setCatState] = useState('growing');
  const [focusScore, setFocusScore] = useState(100);
  const [shinyDrop, setShinyDrop] = useState(null);

  const startTimestampRef = useRef(null);
  const totalDurationRef = useRef(settings.workMinutes * 60);
  const ghostTimeoutRef = useRef(null);
  const leaveTimestampRef = useRef(null);
  const focusLostRef = useRef(0);

  const stats = getTodayStats();

  const nextUnlock = Object.values(CAT_BREEDS)
    .filter((b) => b.unlock > stats.totalCompleted)
    .sort((a, b) => a.unlock - b.unlock)[0] || null;

  const getDuration = useCallback((p, s) => {
    switch (p) {
      case PHASES.WORK: return s.workMinutes * 60;
      case PHASES.SHORT_BREAK: return s.shortBreakMinutes * 60;
      case PHASES.LONG_BREAK: return s.longBreakMinutes * 60;
      default: return s.workMinutes * 60;
    }
  }, []);

  const handleUpdateSettings = useCallback((updated) => {
    const saved = saveSettings(updated);
    setSettings(saved);
    if (!isRunning) {
      const dur = getDuration(phase, saved);
      setTimeRemaining(dur);
      totalDurationRef.current = dur;
    }
  }, [isRunning, phase, getDuration]);

  const startTimer = useCallback(() => {
    if (!currentBreed && phase === PHASES.WORK) {
      setCurrentBreed(pickRandomBreed(stats.totalCompleted));
    }
    setCatState('growing');
    setFocusScore(100);
    focusLostRef.current = 0;
    startTimestampRef.current = Date.now() - ((totalDurationRef.current - timeRemaining) * 1000);
    setIsRunning(true);
  }, [currentBreed, phase, stats.totalCompleted, timeRemaining]);

  const pauseTimer = useCallback(() => {
    setIsRunning(false);
  }, []);

  const advancePhase = useCallback(() => {
    const isWork = phase === PHASES.WORK;

    if (isWork && catState !== 'ghost') {
      addSession({
        breed: currentBreed?.key || 'persian',
        phase: 'work',
        status: 'completed',
        focusScore,
        startedAt: new Date().toISOString(),
        duration: totalDurationRef.current,
      });

      const updatedStats = getTodayStats();
      const drop = checkShinyDrop(updatedStats.streak);
      if (drop) {
        addShiny(drop);
        setShinyDrop(drop);
      }
    } else if (isWork && catState === 'ghost') {
      addSession({
        breed: currentBreed?.key || 'persian',
        phase: 'work',
        status: 'broken',
        focusScore,
        startedAt: new Date().toISOString(),
        duration: totalDurationRef.current,
      });
    }

    let nextPhase;
    let nextSessionIndex = sessionIndex;

    if (isWork) {
      if (sessionIndex + 1 >= settings.sessionsBeforeLong) {
        nextPhase = PHASES.LONG_BREAK;
        nextSessionIndex = 0;
      } else {
        nextPhase = PHASES.SHORT_BREAK;
        nextSessionIndex = sessionIndex + 1;
      }
    } else {
      nextPhase = PHASES.WORK;
      if (phase === PHASES.LONG_BREAK) nextSessionIndex = 0;
    }

    const dur = getDuration(nextPhase, settings);
    setPhase(nextPhase);
    setSessionIndex(nextSessionIndex);
    setTimeRemaining(dur);
    totalDurationRef.current = dur;
    setCurrentBreed(nextPhase === PHASES.WORK ? pickRandomBreed(stats.totalCompleted) : currentBreed);
    setCatState('growing');
    setFocusScore(100);
    focusLostRef.current = 0;
    startTimestampRef.current = null;

    if (settings.autoStart) {
      startTimestampRef.current = Date.now();
      setIsRunning(true);
    } else {
      setIsRunning(false);
    }

    if (settings.audioEnabled) {
      createChimeSound(settings.audioVolume).play();
    }

    if (Notification.permission === 'granted') {
      const msg = nextPhase === PHASES.WORK ? 'Time to focus!' : 'Take a break!';
      new Notification('Meow Operations', { body: msg, icon: '/meow-favicon.png' });
    }
  }, [phase, sessionIndex, settings, currentBreed, catState, focusScore, stats.totalCompleted, getDuration]);

  const resetTimer = useCallback(() => {
    setIsRunning(false);
    setPhase(PHASES.WORK);
    setSessionIndex(0);
    const dur = settings.workMinutes * 60;
    setTimeRemaining(dur);
    totalDurationRef.current = dur;
    setCurrentBreed(null);
    setCatState('growing');
    setFocusScore(100);
    focusLostRef.current = 0;
    startTimestampRef.current = null;
  }, [settings.workMinutes]);

  // Timer tick
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      if (!startTimestampRef.current) {
        startTimestampRef.current = Date.now();
      }
      const elapsed = Math.floor((Date.now() - startTimestampRef.current) / 1000);
      const remaining = Math.max(0, totalDurationRef.current - elapsed);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        advancePhase();
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isRunning, advancePhase]);

  // Page Visibility API
  useEffect(() => {
    if (!settings.focusMode || !isRunning || phase !== PHASES.WORK) return;

    const gracePeriod = settings.strictMode ? 10000 : settings.gracePeriodSeconds * 1000;

    const handleVisibility = () => {
      if (document.hidden) {
        leaveTimestampRef.current = Date.now();
        setCatState('warning');
        ghostTimeoutRef.current = setTimeout(() => {
          setCatState('ghost');
        }, gracePeriod);
      } else {
        if (ghostTimeoutRef.current) clearTimeout(ghostTimeoutRef.current);
        if (leaveTimestampRef.current) {
          const away = Date.now() - leaveTimestampRef.current;
          focusLostRef.current += away;
          const totalMs = totalDurationRef.current * 1000;
          const newScore = Math.max(0, Math.round(100 - (focusLostRef.current / totalMs) * 100));
          setFocusScore(newScore);
        }
        if (catState !== 'ghost') setCatState('growing');
        leaveTimestampRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (ghostTimeoutRef.current) clearTimeout(ghostTimeoutRef.current);
    };
  }, [settings.focusMode, settings.strictMode, settings.gracePeriodSeconds, isRunning, phase, catState]);

  // Request notification permission on first interaction
  useEffect(() => {
    if (isRunning && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [isRunning]);

  const progress = totalDurationRef.current > 0
    ? 1 - (timeRemaining / totalDurationRef.current)
    : 0;

  return (
    <div style={{ position: 'relative', minHeight: 'calc(100vh - 100px)' }}>
      <ParticleCanvas />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 300 }}>Focus Timer</h2>
          <motion.button
            whileHover={{ rotate: 90 }}
            transition={{ duration: 0.3 }}
            onClick={() => setSettingsOpen(true)}
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            <Settings size={20} />
          </motion.button>
        </div>

        {/* Timer */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, paddingTop: 16 }}>
          <TimerRing
            progress={progress}
            timeRemaining={timeRemaining}
            phase={phase}
            isRunning={isRunning}
            sessionIndex={sessionIndex}
            totalSessions={settings.sessionsBeforeLong}
          />

          {/* Cat */}
          <AnimatePresence mode="wait">
            {(currentBreed || phase !== PHASES.WORK) && (
              <motion.div
                key={currentBreed?.key || 'break'}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.5 }}
              >
                {phase === PHASES.WORK && currentBreed ? (
                  <CatBreedSprite
                    breedKey={currentBreed.key}
                    growthProgress={progress}
                    state={catState}
                  />
                ) : (
                  <div style={{ fontSize: 48, textAlign: 'center' }}>
                    {phase === PHASES.SHORT_BREAK ? '😴' : '🌙'}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <ControlButton icon={RotateCcw} onClick={resetTimer} size={40} />
            <ControlButton
              icon={isRunning ? Pause : Play}
              onClick={isRunning ? pauseTimer : startTimer}
              primary
            />
            <ControlButton icon={SkipForward} onClick={advancePhase} size={40} />
          </div>

          {/* Phase dots */}
          <PhaseDots current={sessionIndex} total={settings.sessionsBeforeLong} />

          {/* Focus score */}
          {settings.focusMode && isRunning && phase === PHASES.WORK && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ width: 200, textAlign: 'center' }}
            >
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                Focus: {focusScore}%
              </div>
              <div style={{
                height: 3,
                background: 'var(--bg-accent)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <motion.div
                  animate={{ width: `${focusScore}%` }}
                  style={{
                    height: '100%',
                    background: focusScore > 80 ? 'var(--green)' : focusScore > 50 ? 'var(--amber)' : 'var(--red)',
                    borderRadius: 2,
                  }}
                />
              </div>
            </motion.div>
          )}
        </div>

        {/* Stats */}
        <div style={{ marginTop: 'auto', paddingTop: 24 }}>
          <PomodoroStats stats={stats} nextUnlock={nextUnlock} />
        </div>
      </div>

      <PomodoroSettings
        settings={settings}
        onUpdate={handleUpdateSettings}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <AnimatePresence>
        {shinyDrop && (
          <ShinyDropOverlay shinyDrop={shinyDrop} onDismiss={() => setShinyDrop(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
