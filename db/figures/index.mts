/**
 * Every seeded figure, in library order. To add a figure, write it in
 * its own file with defineFigure (see db/FIGURES.md) and add it here.
 */
import balanceStep from "./balance-step.mts";
import chaChaBasic from "./cha-cha-basic.mts";
import cruzada from "./cruzada.mts";
import forwardWaltz from "./forward-waltz.mts";
import ocho from "./ocho.mts";
import sideBasic from "./side-basic.mts";
import sideStep from "./side-step.mts";
import walkingStep from "./walking-step.mts";

export const figures = {
  walkingStep,
  sideStep,
  cruzada,
  ocho,
  forwardWaltz,
  balanceStep,
  chaChaBasic,
  sideBasic,
};
