import type { SVGProps } from "react";

/**
 * Icon set.
 *
 * Every icon is built from straight segments with mitred joins and square
 * caps — no curves, no rounded ends. That single constraint is what makes a
 * flat 2D icon sit next to a voxel world without looking imported from a
 * different product. They inherit `currentColor` so a rarity or resource
 * colour can drive them directly.
 */

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---- item slots -------------------------------------------------------- */

export const IconPick = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10c3-4 8-6 12-5" />
    <path d="M21 12c-3 4-8 6-12 5" />
    <path d="M9 8.5 15.5 15" />
    <path d="M13 6.5 4 20" />
  </Svg>
);

export const IconDrill = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h6v5H9z" />
    <path d="M10 8h4v4h-4z" />
    <path d="M12 12v4" />
    <path d="M10 16h4l-2 5z" />
  </Svg>
);

export const IconCell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6h12v14H6z" />
    <path d="M10 3h4v3h-4z" />
    <path d="M13 9l-4 5h3l-1 3 4-5h-3z" />
  </Svg>
);

export const IconScanner = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4h6v6H4z" />
    <path d="M4 14v6h6" />
    <path d="M20 10V4h-6" />
    <path d="M14 20h6v-6" />
    <path d="M11 11h2v2h-2z" />
  </Svg>
);

export const IconFrame = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3h8v4H8z" />
    <path d="M5 7h14v6H5z" />
    <path d="M8 13v8" />
    <path d="M16 13v8" />
  </Svg>
);

/* ---- resources --------------------------------------------------------- */

export const IconOre = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4 8v8l8 5 8-5V8z" />
    <path d="M12 9 8 11v4l4 2 4-2v-4z" />
  </Svg>
);

export const IconIngot = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9h12l3 8H3z" />
    <path d="M9 9V6h6v3" />
  </Svg>
);

export const IconCoal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9l4-4 6 1 4 5-3 7H7z" />
  </Svg>
);

export const IconCrystal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2 6 11l6 11 6-11z" />
    <path d="M6 11h12" />
  </Svg>
);

export const IconEnergy = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
  </Svg>
);

/* ---- buildings --------------------------------------------------------- */

export const IconExtractor = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21h16" />
    <path d="M7 21V9h10v12" />
    <path d="M9 9V4h6v5" />
    <path d="M12 12v6" />
  </Svg>
);

export const IconSmelter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <path d="M5 21V11h10v10" />
    <path d="M15 21V7h4v14" />
    <path d="M8 15h4v6H8z" />
  </Svg>
);

export const IconGenerator = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <path d="M5 21V10h12v11" />
    <path d="M8 10V5h2v5" />
    <path d="M13 10V5h2v5" />
  </Svg>
);

export const IconSilo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 21V8h12v13" />
    <path d="M6 8l6-5 6 5" />
    <path d="M6 14h12" />
  </Svg>
);

export const IconHabitat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21V9h16v12z" />
    <path d="M8 13h3v3H8z" />
    <path d="M13 13h3v3h-3z" />
    <path d="M4 9l8-6 8 6" />
  </Svg>
);

export const IconMarket = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <path d="M5 21V11h14v10" />
    <path d="M3 11l2-6h14l2 6z" />
    <path d="M10 21v-6h4v6" />
  </Svg>
);

export const IconLab = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3v7L4 21h16l-6-11V3" />
    <path d="M8 3h8" />
    <path d="M7.5 15h9" />
  </Svg>
);

/* ---- interface --------------------------------------------------------- */

export const IconCrate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
    <path d="M3 7l9 4 9-4" />
    <path d="M12 11v10" />
  </Svg>
);

export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h15v13H3z" />
    <path d="M3 6l13-3v3" />
    <path d="M14 11h5v4h-5z" />
  </Svg>
);

export const IconTag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3h8l10 10-8 8L3 11z" />
    <path d="M7.5 7.5h.01" strokeWidth={2.6} />
  </Svg>
);

export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <path d="M6 21V12" />
    <path d="M11 21V6" />
    <path d="M16 21v-6" />
    <path d="M21 21V9" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5l14 14M19 5L5 19" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12l5 6L20 5" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 2 21h20z" />
    <path d="M12 10v5" />
    <path d="M12 18h.01" strokeWidth={2.4} />
  </Svg>
);

export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h6v3l2 1 3-2 3 5-3 2v2l3 2-3 5-3-2-2 1v3H9v-3l-2-1-3 2-3-5 3-2v-2L1 9l3-5 3 2 2-1z" />
    <path d="M9 12h6" />
  </Svg>
);

export const IconCube = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2 3 7v10l9 5 9-5V7z" />
    <path d="M3 7l9 5 9-5" />
    <path d="M12 12v10" />
  </Svg>
);

export const IconStack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="M3 13l9 5 9-5" />
    <path d="M3 17.5l9 5 9-5" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 11h14v10H5z" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4H4v16h16v-6" />
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4h12v12H4z" />
    <path d="M16 16l4 4" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 5v6h-6" />
    <path d="M4 19v-6h6" />
    <path d="M19 11a7 7 0 0 0-12-4L4 10" />
    <path d="M5 13a7 7 0 0 0 12 4l3-3" />
  </Svg>
);

/* ---- lookup ------------------------------------------------------------ */

import type { BuildingKind, ItemSlot } from "@/sim/types";
import type { ComponentType } from "react";

export const SLOT_ICONS: Record<ItemSlot, ComponentType<IconProps>> = {
  pick: IconPick,
  drill: IconDrill,
  cell: IconCell,
  scanner: IconScanner,
  frame: IconFrame,
};

export const BUILDING_ICONS: Record<BuildingKind, ComponentType<IconProps>> = {
  extractor: IconExtractor,
  smelter: IconSmelter,
  generator: IconGenerator,
  silo: IconSilo,
  habitat: IconHabitat,
  market: IconMarket,
  lab: IconLab,
};
