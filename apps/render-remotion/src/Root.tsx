import React from "react";
import { Composition } from "remotion";

import { ensureArabicFonts } from "./fonts";
import { RaizDarkHook01, type RaizDarkHook01Props } from "./templates/RaizDarkHook01";

const FPS = 30;
const DEFAULT_DURATION_SECONDS = 10;

ensureArabicFonts();

export const RaizRoot: React.FC = () => {
  return (
    <Composition
      id="raiz-dark-hook-01"
      component={RaizDarkHook01}
      durationInFrames={FPS * DEFAULT_DURATION_SECONDS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={
        {
          hook: "إنت مش تعبان… إنت مُفرطن.",
          title: "",
          captions: [],
          durationInSeconds: DEFAULT_DURATION_SECONDS,
          brollSrc: "",
          brollDurationInSeconds: 0
        } satisfies RaizDarkHook01Props
      }
      calculateMetadata={({ props }) => {
        const seconds =
          typeof props.durationInSeconds === "number" && props.durationInSeconds > 0
            ? props.durationInSeconds
            : DEFAULT_DURATION_SECONDS;

        return {
          durationInFrames: Math.max(1, Math.round(seconds * FPS)),
          fps: FPS
        };
      }}
    />
  );
};
