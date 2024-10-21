import { motion } from '../handlers/handler.motions';
import { searchWords } from '../utils/words';
import { Command } from './command';
import { Goto, type MotionBase } from './commands.general';
export const MotionChange = new Command<MotionBase>('motion.change', (args) => {
	return motion({
		args,
		onMotion: ['select', 'delete'],
	});
});

export const MotionChangePrev = new Command('motion.changeBackward', () => MotionChange.execute({ isPrev: true }));
export const MotionChangeNext = new Command('motion.changeForward', () => MotionChange.execute({ isNext: true }));

export const MotionSelect = new Command<MotionBase>('motion.select', (args) => {
	return motion({
		args,
		onMotion: ['select'],
	});
});
export const MotionSelectNext = new Command('motion.selectForward', () => MotionSelect.execute({ isNext: true }));
export const MotionSelectPrev = new Command('motion.selectBackward', () => MotionSelect.execute({ isPrev: true }));

export const MotionGoto = new Command('motion.goto', (args) => Goto({ ...args }));
// export const MotionGotoNext = new Command('motion.gotoForward', (args) => Goto({ ...args, isNext: true }));
// export const MotionGotoPrev = new Command('motion.gotoBackward', (args) => Goto({ ...args, isPrev: true }));

export const MotionRepeat = new Command<MotionBase>('motion.repeat', ({ state, ...args }) => {
	if (!state.prev.motion) return;
	const { onMotion, onSearch, input } = state.prev.motion;
	const isPrev = args.isPrev;
	const isNext = args.isNext;
	return motion({
		args: { state, inputOverride: input, isSearch: state.prev.motion.input.isSearch, isNext, isPrev },
		onMotion,
		onSearch,
	});
});
export const MotionRepeatNext = new Command('motion.repeatForward', () => MotionRepeat.execute({ isNext: true }));
export const MotionRepeatPrev = new Command('motion.repeatBackward', () => MotionRepeat.execute({ isPrev: true }));

export const MotionSearch = new Command<MotionBase>('motion.searchFromLine', ({ ...args }) => {
	const isLine = !args?.isNext && !args?.isPrev;
	return motion({
		args: { ...args, isSearch: true, isLine },
		onSearch: ({ input, matches, select }) => {
			if (!matches?.next) return;
			args.state.showDecorations();
			return { value: input.motion.value, selections: select([matches.next.process().range]) };
		},
	});
});
export const MotionSearchNext = new Command('motion.searchForward', () => MotionSearch.execute({ isNext: true }));
export const MotionSearchPrev = new Command('motion.searchBackward', () => MotionSearch.execute({ isPrev: true }));
