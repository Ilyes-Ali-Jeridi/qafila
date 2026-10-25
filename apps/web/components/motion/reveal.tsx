'use client';
/**
 * Page-load reveals. One orchestrated entrance per page: wrap the page in <Stagger> and each
 * block in <Item>. Reduced motion turns every reveal into a fade.
 */
import { motion, useReducedMotion, type HTMLMotionProps, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

const EASE = [0.16, 1, 0.3, 1] as const;

export function useRevealVariants(y = 14): Variants {
  const reduce = useReducedMotion();
  return {
    hidden: { opacity: 0, y: reduce ? 0 : y },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0.2 : 0.6, ease: EASE } },
  };
}

export function Stagger({ children, className, delay = 0, gap = 0.07, ...rest }: HTMLMotionProps<'div'> & { children: ReactNode; delay?: number; gap?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : gap, delayChildren: reduce ? 0 : delay } } }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function Item({ children, className, y = 14, ...rest }: HTMLMotionProps<'div'> & { children?: ReactNode; y?: number }) {
  const variants = useRevealVariants(y);
  return (
    <motion.div className={className} variants={variants} {...rest}>
      {children}
    </motion.div>
  );
}

/** Standalone reveal for a single block, with an optional delay in seconds. */
export function Reveal({ children, className, delay = 0, y = 14, ...rest }: HTMLMotionProps<'div'> & { children?: ReactNode; delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0.2 : 0.6, ease: EASE, delay: reduce ? 0 : delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Reveal when scrolled into view, once. */
export function InView({ children, className, delay = 0, y = 18, ...rest }: HTMLMotionProps<'div'> & { children?: ReactNode; delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: reduce ? 0.2 : 0.7, ease: EASE, delay: reduce ? 0 : delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
