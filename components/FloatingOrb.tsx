'use client';

import { useEffect, useState } from 'react';
import { useTheme, getMonkVariantForTheme } from '../hooks/useTheme';

type OrbState = 'floating' | 'opening' | 'opened';

type FloatingOrbProps = {
  state?: OrbState;
  onOpenComplete?: () => void;
  size?: number;
};

export default function FloatingOrb({
  state = 'floating',
  onOpenComplete,
  size = 120
}: FloatingOrbProps) {
  const theme = useTheme();
  const variant = getMonkVariantForTheme(theme);
  const [breath, setBreath] = useState(0);
  const [stars, setStars] = useState<Array<{width: number, height: number, left: string, top: string}>>([]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      setBreath(Math.sin((t - start) / 2000) * 0.5 + 0.5);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Generate star positions only on client side to avoid hydration mismatch
  useEffect(() => {
    const starData = [...Array(8)].map(() => ({
      width: Math.random() * 3 + 1,
      height: Math.random() * 3 + 1,
      left: `${Math.random() * 80 + 10}%`,
      top: `${Math.random() * 80 + 10}%`
    }));
    setStars(starData);
  }, []);

  useEffect(() => {
    if (state === 'opening') {
      const timer = setTimeout(() => {
        onOpenComplete?.();
      }, 800); // Animation duration
      return () => clearTimeout(timer);
    }
  }, [state, onOpenComplete]);

  // Theme-aware colors
  const colors = {
    current: { primary: '#5f7f7b', secondary: '#a8c4c0', accent: '#d4ebe8' },
    sunset: { primary: '#e07a3c', secondary: '#d4af6e', accent: '#ffe7b0' },
    aurora: { primary: '#5eead4', secondary: '#4a5e7a', accent: '#94d3a2' },
    ocean: { primary: '#1f7da6', secondary: '#6a9ac6', accent: '#b8d8f0' },
    sunrise: { primary: '#5eead4', secondary: '#d4af6e', accent: '#ffe7b0' },
    jade: { primary: '#fbbf24', secondary: '#7ac39a', accent: '#c8f0d8' },
    twilight: { primary: '#f0abfc', secondary: '#9a7acd', accent: '#d8c8ff' }
  }[variant] || { primary: '#5f7f7b', secondary: '#a8c4c0', accent: '#d4ebe8' };

  const floatY = (breath - 0.5) * 8;
  const scale = 1 + (breath - 0.5) * 0.08;

  const orbScale = state === 'opening' ? 1.2 : scale;
  const orbOpacity = state === 'opened' ? 0 : 1;

  return (
    <div className="flex justify-center items-center" data-testid="floating-orb">
      <div
        className={`relative transition-all duration-1500 ${
          state === 'opening' ? 'animate-pulse' : ''
        }`}
        style={{
          transform: `translateY(${floatY}px) scale(${orbScale})`,
          opacity: orbOpacity,
          transition: state === 'opening'
            ? 'transform 1.5s ease-out, opacity 1.5s ease-out'
            : 'transform 0.1s linear'
        }}
      >
        {/* Galaxy rings - contained within orb */}
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{
            width: size * 0.9,
            height: size * 0.9,
            background: `conic-gradient(from 0deg, transparent, ${colors.accent}30, transparent, ${colors.secondary}40, transparent)`,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            animationDuration: '20s'
          }}
        />
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{
            width: size * 0.7,
            height: size * 0.7,
            background: `conic-gradient(from 180deg, transparent, ${colors.primary}25, transparent, ${colors.accent}35, transparent)`,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            animationDuration: '15s',
            animationDirection: 'reverse'
          }}
        />

        {/* Main orb */}
        <div
          className="relative rounded-full"
          style={{
            width: size,
            height: size,
            background: `radial-gradient(circle at 30% 30%, ${colors.accent}, ${colors.primary})`
          }}
        >
          {/* Inner shimmer effect */}
          <div
            className="absolute inset-2 rounded-full opacity-60"
            style={{
              background: `radial-gradient(circle at 40% 20%, white, transparent 70%)`,
              animation: 'pulse 2s ease-in-out infinite'
            }}
          />

          {/* Galaxy stars inside */}
          <div className="absolute inset-0 rounded-full overflow-hidden">
            {stars.map((star, i) => (
              <div
                key={i}
                className="absolute bg-white rounded-full animate-pulse"
                style={{
                  width: star.width,
                  height: star.height,
                  left: star.left,
                  top: star.top,
                  opacity: 0.4 + (i * 0.1),
                  animationDuration: `${2 + (i * 0.3)}s`,
                  animationDelay: `${i * 0.25}s`
                }}
              />
            ))}

            {/* Swirling cosmic dust */}
            <div
              className="absolute inset-2 rounded-full animate-spin"
              style={{
                background: `radial-gradient(ellipse at center, transparent 40%, ${colors.accent}20, transparent 80%)`,
                animationDuration: '12s'
              }}
            />
          </div>

          {/* Opening crack effect */}
          {state === 'opening' && (
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `linear-gradient(45deg, transparent 45%, white 50%, transparent 55%)`,
                opacity: 0.8,
                animation: 'crack 1.5s ease-out forwards'
              }}
            />
          )}
        </div>

        {/* Energy emanation during opening */}
        {state === 'opening' && (
          <div className="absolute inset-0 pointer-events-none">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  background: colors.accent,
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) rotate(${i * 45}deg) translateY(-${size/2 + 20}px)`,
                  animation: `energyBurst 1.5s ease-out forwards`,
                  animationDelay: `${i * 0.1}s`,
                  opacity: 0
                }}
              />
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes crack {
          0% { transform: scaleY(0); opacity: 0; }
          50% { transform: scaleY(1); opacity: 0.8; }
          100% { transform: scaleY(1); opacity: 0; }
        }

        @keyframes energyBurst {
          0% {
            transform: translate(-50%, -50%) rotate(${0}deg) translateY(-${size/2}px) scale(0);
            opacity: 0;
          }
          50% {
            opacity: 1;
            transform: translate(-50%, -50%) rotate(${0}deg) translateY(-${size/2 + 40}px) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) rotate(${0}deg) translateY(-${size/2 + 80}px) scale(0.5);
          }
        }
      `}</style>
    </div>
  );
}