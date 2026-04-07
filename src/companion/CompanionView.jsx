import { useEffect, useRef, useState, useCallback, Component, lazy, Suspense } from 'react';
import {
  getState,
  hasCat,
  getMood,
  getMemorial,
  feed,
  play,
  groom,
  sleep,
  toggleAccessory,
  purchaseAccessory,
  setRoom,
  bury,
  claimSessionRewards,
  subscribe,
} from '../lib/companion-store';
import { getBreed } from '../lib/companion-breeds';
import CompanionCat from './CompanionCat';
import CompanionRoom from './CompanionRoom';
import CompanionStats from './CompanionStats';
import CompanionActions from './CompanionActions';
import FoodInventoryDrawer from './FoodInventoryDrawer';
import AccessoryWardrobe from './AccessoryWardrobe';
import RoomDecorator from './RoomDecorator';
import MemorialDrawer from './MemorialDrawer';
import FarewellModal from './FarewellModal';
import BreedPicker from './BreedPicker';
import CompanionEffects from './CompanionEffects';

// Lazy-load the heavy Three.js scene — keeps main bundle lean
const CompanionScene3D = lazy(() => import('./CompanionScene3D'));

// Error boundary so a 3D crash never takes down the whole app
class Scene3DErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <CompanionRoom roomKey={this.props.roomKey}>
          <div ref={this.props.catRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>
            <CompanionCat cat={this.props.cat} mood={this.props.mood} size={300} />
          </div>
        </CompanionRoom>
      );
    }
    return this.props.children;
  }
}

export default function CompanionView({ sessions }) {
  const [tick, setTick] = useState(0);
  const [drawer, setDrawer] = useState(null); // 'feed' | 'wardrobe' | 'room' | null
  const [effect, setEffect] = useState(null);
  const [rewardToast, setRewardToast] = useState(null);
  const sceneRef = useRef(null); // ref on the 3D scene container for effect catRect

  // Subscribe to store mutations + heartbeat for decay
  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => { unsub(); clearInterval(id); };
  }, []);

  // Claim session rewards whenever sessions prop changes (i.e. after refresh)
  useEffect(() => {
    if (!sessions || sessions.length === 0) return;
    if (!hasCat()) return;
    const result = claimSessionRewards(sessions);
    const totalAwarded = Object.values(result.awarded || {}).reduce((a, b) => a + b, 0);
    if (totalAwarded > 0) {
      setRewardToast({ count: totalAwarded, growth: result.growth || 0 });
      setTimeout(() => setRewardToast(null), 4000);
    }
  }, [sessions]);

  const state = getState();
  const cat = state.cat;
  const memorial = state.memorial;
  const mood = getMood(cat);
  const breed = cat ? getBreed(cat.breed) : null;

  const handleAdoptNew = useCallback(() => {
    bury();
    setTick((t) => t + 1);
  }, []);

  const handleAction = useCallback((id) => {
    if (id === 'feed') { setDrawer('feed'); return; }
    if (id === 'wardrobe') { setDrawer('wardrobe'); return; }
    if (id === 'room') { setDrawer('room'); return; }
    if (id === 'play') { play(); fireEffect('play'); return; }
    if (id === 'groom') { groom(); fireEffect('groom'); return; }
    if (id === 'sleep') { sleep(); fireEffect('sleep'); return; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fireEffect = (type) => {
    const catRect = sceneRef.current?.getBoundingClientRect() ?? null;
    setEffect({ type, id: Date.now(), catRect });
    setTimeout(() => setEffect(null), 2800);
  };

  const handleFeed = (foodKey) => {
    if (feed(foodKey)) {
      fireEffect('feed');
      setDrawer(null);
    }
  };
  const handleToggleAccessory = (key) => { toggleAccessory(key); };
  const handlePurchaseAccessory = (key) => { purchaseAccessory(key); };
  const handleSetRoom = (key) => { setRoom(key); setDrawer(null); };

  // No companion adopted yet
  if (!cat) {
    return (
      <div>
        <BreedPicker onAdopted={() => setTick((t) => t + 1)} />
        <div style={{ padding: '0 24px 24px' }}>
          <MemorialDrawer memorial={memorial} />
        </div>
      </div>
    );
  }

  // Cat ran away — keep 2D grayscale for the farewell screen
  if (cat.status === 'lost') {
    return (
      <>
        <FarewellModal cat={cat} onAdoptNew={handleAdoptNew} />
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 32px)' }}>
          <CompanionRoom roomKey={cat.room?.key || 'corner_mat'}>
            <div style={{ filter: 'grayscale(80%)', opacity: 0.3 }}>
              <CompanionCat cat={cat} mood="critical" size={300} />
            </div>
          </CompanionRoom>
        </div>
      </>
    );
  }

  const roomKey = cat.room?.key || 'corner_mat';

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 280px',
          gap: 16,
          alignItems: 'stretch',
          height: 'calc(100vh - 110px)',
          minHeight: 540,
        }}
      >
        {/* Left: 3D scene + actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
          {/* 3D scene container — ref used for effect catRect */}
          <div
            ref={sceneRef}
            style={{ flex: 1, minHeight: 0, borderRadius: 16, overflow: 'hidden' }}
          >
            <Scene3DErrorBoundary roomKey={roomKey} cat={cat} mood={mood} catRef={sceneRef}>
              <Suspense fallback={
                <div style={{ width: '100%', height: '100%', background: 'var(--bg-card)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Loading scene…
                </div>
              }>
                <CompanionScene3D cat={cat} mood={mood} breed={breed} />
              </Suspense>
            </Scene3DErrorBoundary>
          </div>

          <CompanionEffects
            effect={effect}
            catRect={effect?.catRect ?? null}
            palette={breed?.palette}
          />
          <CompanionActions onAction={handleAction} />
        </div>

        {/* Right: stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          <CompanionStats cat={cat} />

          {/* Quick info */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Mood
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
              {mood}
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Last fed
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {relativeTime(cat.lastFedAt)}
            </div>
          </div>
        </div>
      </div>

      <MemorialDrawer memorial={memorial} />

      <FoodInventoryDrawer
        open={drawer === 'feed'}
        onClose={() => setDrawer(null)}
        cat={cat}
        onFeed={handleFeed}
      />
      <AccessoryWardrobe
        open={drawer === 'wardrobe'}
        onClose={() => setDrawer(null)}
        cat={cat}
        onPurchase={handlePurchaseAccessory}
        onToggle={handleToggleAccessory}
      />
      <RoomDecorator
        open={drawer === 'room'}
        onClose={() => setDrawer(null)}
        cat={cat}
        onSetRoom={handleSetRoom}
      />

      {/* Reward toast */}
      {rewardToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            padding: '12px 18px',
            background: 'var(--bg-card)',
            border: '1px solid var(--accent)',
            borderRadius: 10,
            color: 'var(--text-primary)',
            fontSize: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            zIndex: 90,
          }}
        >
          🍣 +{rewardToast.count} food earned · +{rewardToast.growth} growth
        </div>
      )}
    </div>
  );
}

function relativeTime(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + ' min ago';
  if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + ' hr ago';
  return Math.floor(ms / 86_400_000) + ' days ago';
}
