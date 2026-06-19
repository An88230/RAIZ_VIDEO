import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Loop,
  OffthreadVideo,
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

export interface RaizDarkHook01Props {
  hook: string;
  title?: string;
  captions: CaptionCue[];
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

export const RaizDarkHook01: React.FC<RaizDarkHook01Props> = ({
  hook,
  captions,
  brollSrc,
  brollDurationInSeconds
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  const hookOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const hookScale = interpolate(frame, [0, 24], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const drift = Math.sin(t * 0.6) * 6;

  const activeCaption = captions.find((cue) => t >= cue.fromSec && t < cue.toSec);

  const hasBroll = Boolean(brollSrc);
  const loopFrames =
    brollDurationInSeconds && brollDurationInSeconds > 0
      ? Math.max(1, Math.round(brollDurationInSeconds * fps))
      : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      {hasBroll ? (
        <AbsoluteFill>
          {loopFrames > 0 ? (
            <Loop durationInFrames={loopFrames}>
              <OffthreadVideo src={staticFile(brollSrc as string)} muted style={fillVideoStyle} />
            </Loop>
          ) : (
            <OffthreadVideo src={staticFile(brollSrc as string)} muted style={fillVideoStyle} />
          )}
        </AbsoluteFill>
      ) : null}

      {/* Darkening overlay keeps the white Arabic hook readable over footage. */}
      {hasBroll ? <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.58)" }} /> : null}

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 38%, rgba(70,70,95,0.38), rgba(0,0,0,0) 60%)"
        }}
      />

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: "0 90px" }}
      >
        <div
          style={{
            transform: `translateY(${drift}px) scale(${hookScale})`,
            opacity: hookOpacity,
            maxWidth: width - 180
          }}
        >
          <ArabicText
            weight={700}
            style={{
              fontSize: 96,
              lineHeight: 1.25,
              color: "#ffffff",
              textAlign: "center",
              textShadow: "0 4px 30px rgba(0,0,0,0.8)"
            }}
          >
            {hook}
          </ArabicText>
        </div>
      </AbsoluteFill>

      {activeCaption ? (
        <div style={{ position: "absolute", left: 90, right: 90, bottom: 260, textAlign: "center" }}>
          <ArabicText
            weight={600}
            style={{
              fontSize: 54,
              lineHeight: 1.3,
              color: "#ffffff",
              backgroundColor: "rgba(0,0,0,0.5)",
              padding: "16px 26px",
              borderRadius: 18,
              display: "inline-block",
              textShadow: "0 2px 10px rgba(0,0,0,0.9)"
            }}
          >
            {activeCaption.text}
          </ArabicText>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
