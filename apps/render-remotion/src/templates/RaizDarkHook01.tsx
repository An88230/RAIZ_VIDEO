import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

import { ArabicText } from "../components/ArabicText";

export interface CaptionCue {
  text: string;
  fromSec: number;
  toSec: number;
}

export interface ScenePlan {
  kind: "content" | "final";
  heading?: string;
  text: string;
  fromSec: number;
  toSec: number;
  bgVariant?: number;
  brollSrc?: string;
  brollDurationInSeconds?: number;
}

export interface RaizDarkHook01Props {
  hook: string;
  title?: string;
  seriesTitleAr?: string;
  seriesTitleEn?: string;
  headlineMainWord?: string;
  supportingCaption?: string;
  footerText?: string;
  mood?: "calm" | "dark" | "emotional" | "minimal";
  captions: CaptionCue[];
  scenes?: ScenePlan[];
  footer?: string | null;
  brollStatus?: string;
  durationInSeconds?: number;
  /** Optional background b-roll, relative to the Remotion public dir. */
  brollSrc?: string;
  brollDurationInSeconds?: number;
}

const fillVideoStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
};

// Slightly different dark tints per scene so consecutive scenes do not look
// identical (the "static title card" complaint).
const SCENE_TINTS = [
  "rgba(70,70,110,0.30)",
  "rgba(110,70,80,0.28)",
  "rgba(60,95,100,0.28)",
  "rgba(95,85,60,0.28)",
  "rgba(80,70,110,0.30)"
];

interface LockedSeriesText {
  seriesTitleAr?: string;
  seriesTitleEn?: string;
  headlineMainWord?: string;
  supportingCaption?: string;
  footerText?: string;
}

/** Animated abstract background used when no real b-roll clip is available. */
const AbstractBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const x1 = 50 + Math.sin(t * 0.25) * 18;
  const y1 = 38 + Math.cos(t * 0.2) * 12;
  const x2 = 50 + Math.cos(t * 0.18) * 22;
  const y2 = 70 + Math.sin(t * 0.22) * 14;

  return (
    <AbsoluteFill style={{ backgroundColor: "#06060a" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${x1}% ${y1}%, rgba(90,90,140,0.38), rgba(0,0,0,0) 55%)`
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${x2}% ${y2}%, rgba(120,80,90,0.30), rgba(0,0,0,0) 55%)`
        }}
      />
    </AbsoluteFill>
  );
};

const ContentScene: React.FC<{
  scene: ScenePlan;
  footer?: string | null;
  lockedText?: LockedSeriesText;
  width: number;
  durationInFrames: number;
}> = ({ scene, footer, lockedText, width, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tint = SCENE_TINTS[(scene.bgVariant ?? 0) % SCENE_TINTS.length];
  const mainWord = lockedText?.headlineMainWord?.trim();
  const supportLine = lockedText?.supportingCaption?.trim();
  const seriesTitleAr = lockedText?.seriesTitleAr?.trim() || scene.heading?.trim() || "";
  const seriesTitleEn = lockedText?.seriesTitleEn?.trim() || "";
  const footerLine = lockedText?.footerText?.trim() || footer?.trim() || "";
  const usesLockedLayout = Boolean(mainWord || supportLine || seriesTitleEn || lockedText?.footerText);

  // Fade in, then hold, then fade out at the scene boundary.
  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [Math.max(1, durationInFrames - 12), durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const opacity = Math.min(fadeIn, fadeOut);
  const scaleIn = interpolate(frame, [0, 20], [0.94, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const drift = Math.sin((frame / fps) * 0.6) * 6;
  const titleY = interpolate(frame, [0, 18], [-16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const wordScale = interpolate(frame, [4, 26], [0.9, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const supportOpacity = interpolate(frame, [14, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const footerOpacity = interpolate(frame, [20, 42], [0, 0.78], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const headlineFontSize = mainWord && [...mainWord].length > 9 ? 118 : 142;

  return (
    <AbsoluteFill>
      {scene.brollSrc ? (
        <AbsoluteFill>
          {scene.brollDurationInSeconds && scene.brollDurationInSeconds > 0 ? (
            <Loop durationInFrames={Math.max(1, Math.round(scene.brollDurationInSeconds * fps))}>
              <OffthreadVideo src={staticFile(scene.brollSrc)} muted style={fillVideoStyle} />
            </Loop>
          ) : (
            <OffthreadVideo src={staticFile(scene.brollSrc)} muted style={fillVideoStyle} />
          )}
          <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.54)" }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ backgroundColor: tint }} />
      )}

      {usesLockedLayout ? (
        <>
          <div
            style={{
              position: "absolute",
              top: 116,
              left: 86,
              right: 86,
              textAlign: "center",
              transform: `translateY(${titleY}px)`,
              opacity: opacity * 0.92
            }}
          >
            {seriesTitleAr ? (
              <ArabicText
                weight={700}
                style={{
                  fontSize: 48,
                  lineHeight: 1.12,
                  color: "rgba(255,255,255,0.93)",
                  textAlign: "center",
                  textShadow: "0 3px 20px rgba(0,0,0,0.72)"
                }}
              >
                {seriesTitleAr}
              </ArabicText>
            ) : null}
            {seriesTitleEn ? (
              <div
                style={{
                  marginTop: 12,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 39,
                  lineHeight: 1.05,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.92)",
                  direction: "ltr",
                  textShadow: "0 3px 18px rgba(0,0,0,0.72)"
                }}
              >
                {seriesTitleEn}
              </div>
            ) : null}
          </div>

          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 82px" }}>
            <div
              style={{
                transform: `translateY(${drift + 150}px) scale(${wordScale})`,
                opacity,
                maxWidth: width - 150,
                textAlign: "center"
              }}
            >
              {mainWord ? (
                <ArabicText
                  weight={700}
                  style={{
                    fontSize: headlineFontSize,
                    lineHeight: 1,
                    color: "#ff7a16",
                    textAlign: "center",
                    textShadow: "0 6px 30px rgba(0,0,0,0.78)"
                  }}
                >
                  {mainWord}
                </ArabicText>
              ) : null}
              {supportLine ? (
                <ArabicText
                  weight={700}
                  style={{
                    marginTop: 12,
                    fontSize: 52,
                    lineHeight: 1.12,
                    color: "#ffffff",
                    textAlign: "center",
                    opacity: supportOpacity,
                    textShadow: "0 4px 24px rgba(0,0,0,0.82)"
                  }}
                >
                  {supportLine}
                </ArabicText>
              ) : null}
            </div>
          </AbsoluteFill>

          {footerLine ? (
            <div style={{ position: "absolute", left: 80, right: 80, bottom: 88, textAlign: "center", opacity: footerOpacity }}>
              <div
                style={{
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 34,
                  lineHeight: 1.1,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.82)",
                  direction: "ltr",
                  textShadow: "0 3px 18px rgba(0,0,0,0.75)"
                }}
              >
                {footerLine}
              </div>
            </div>
          ) : null}
        </>
      ) : scene.heading?.trim() ? (
        <div style={{ position: "absolute", top: 120, left: 90, right: 90, textAlign: "center", opacity: opacity * 0.85 }}>
          <ArabicText weight={600} style={{ fontSize: 40, lineHeight: 1.35, color: "rgba(255,255,255,0.72)" }}>
            {scene.heading}
          </ArabicText>
        </div>
      ) : null}

      {!usesLockedLayout ? (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 90px" }}>
          <div style={{ transform: `translateY(${drift}px) scale(${scaleIn})`, opacity, maxWidth: width - 170 }}>
            <ArabicText
              weight={700}
              style={{
                fontSize: 86,
                lineHeight: 1.25,
                color: "#ffffff",
                textAlign: "center",
                textShadow: "0 4px 30px rgba(0,0,0,0.85)"
              }}
            >
              {scene.text}
            </ArabicText>
          </div>
        </AbsoluteFill>
      ) : null}

      {!usesLockedLayout && footer?.trim() ? (
        <div style={{ position: "absolute", left: 80, right: 80, bottom: 90, textAlign: "center", opacity: opacity * 0.6 }}>
          <ArabicText weight={400} style={{ fontSize: 26, lineHeight: 1.2, color: "rgba(255,255,255,0.5)" }}>
            {footer}
          </ArabicText>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const FinalScene: React.FC<{ scene: ScenePlan; title?: string; footer?: string | null; width: number }> = ({
  scene,
  title,
  footer,
  width
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lineWidth = interpolate(frame, [6, 30], [0, 220], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 90px" }}>
      <AbsoluteFill style={{ backgroundColor: "rgba(10,10,16,0.55)" }} />
      <div style={{ opacity, maxWidth: width - 170, textAlign: "center" }}>
        <ArabicText
          weight={700}
          style={{ fontSize: 78, lineHeight: 1.25, color: "#ffffff", textAlign: "center", textShadow: "0 4px 30px rgba(0,0,0,0.85)" }}
        >
          {title?.trim() || scene.text}
        </ArabicText>
        <div style={{ height: 3, width: lineWidth, backgroundColor: "rgba(255,255,255,0.5)", margin: "32px auto 0" }} />
        {footer?.trim() ? (
          <div style={{ marginTop: 28 }}>
            <ArabicText weight={400} style={{ fontSize: 30, lineHeight: 1.3, color: "rgba(255,255,255,0.7)", textAlign: "center" }}>
              {footer}
            </ArabicText>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const RaizDarkHook01: React.FC<RaizDarkHook01Props> = ({
  hook,
  title,
  seriesTitleAr,
  seriesTitleEn,
  headlineMainWord,
  supportingCaption,
  footerText,
  captions,
  scenes,
  footer,
  brollSrc,
  brollDurationInSeconds
}) => {
  const { fps, width, durationInFrames: compositionFrames } = useVideoConfig();

  const hasBroll = Boolean(brollSrc);
  const loopFrames =
    brollDurationInSeconds && brollDurationInSeconds > 0 ? Math.max(1, Math.round(brollDurationInSeconds * fps)) : 0;
  const lockedText = {
    seriesTitleAr,
    seriesTitleEn,
    headlineMainWord,
    supportingCaption,
    footerText
  };

  // Back-compat: if no scene plan is supplied, synthesize a minimal two-scene plan
  // from the hook + captions so the composition is never a single static card.
  const scenePlan: ScenePlan[] =
    scenes && scenes.length > 0
      ? scenes
      : [
          { kind: "content", heading: title, text: hook, fromSec: 0, toSec: 3, bgVariant: 0 },
          ...captions.map((cue, index) => ({
            kind: "content" as const,
            heading: title,
            text: cue.text,
            fromSec: cue.fromSec,
            toSec: cue.toSec,
            bgVariant: (index + 1) % SCENE_TINTS.length
          }))
        ];

  return (
    <AbsoluteFill style={{ backgroundColor: "#06060a" }}>
      {hasBroll ? (
        <AbsoluteFill>
          {loopFrames > 0 ? (
            <Loop durationInFrames={loopFrames}>
              <OffthreadVideo src={staticFile(brollSrc as string)} muted style={fillVideoStyle} />
            </Loop>
          ) : (
            <OffthreadVideo src={staticFile(brollSrc as string)} muted style={fillVideoStyle} />
          )}
          <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.58)" }} />
        </AbsoluteFill>
      ) : (
        <AbstractBackground />
      )}

      {scenePlan.map((scene, index) => {
        const from = Math.max(0, Math.round(scene.fromSec * fps));
        const rawDuration = Math.round((scene.toSec - scene.fromSec) * fps);
        const durationInFrames = Math.max(1, Number.isFinite(rawDuration) ? rawDuration : fps);

        return (
          <Sequence key={`${scene.kind}-${index}`} from={from} durationInFrames={durationInFrames}>
            {scene.kind === "final" ? (
              <FinalScene scene={scene} title={title} footer={footer} width={width} />
            ) : (
              <ContentScene scene={scene} footer={footer} lockedText={lockedText} width={width} durationInFrames={durationInFrames} />
            )}
          </Sequence>
        );
      })}

      {/* Keep the very last frame populated even if scene timings round short. */}
      {compositionFrames > 0 ? null : null}
    </AbsoluteFill>
  );
};
