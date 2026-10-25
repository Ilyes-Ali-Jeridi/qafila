'use client';
import dynamic from 'next/dynamic';
import { StoryStack } from './story-stack';

/** GSAP story, browser only; the stacked cards render first so the content never waits on the chunk. */
export const StoryDynamic = dynamic(() => import('./story'), { ssr: false, loading: () => <StoryStack /> });
