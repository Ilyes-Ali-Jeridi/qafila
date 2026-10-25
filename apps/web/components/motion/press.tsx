'use client';
/** Spring hover and press for cards and buttons. Reduced motion disables the scale. */
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';

export function Pressable({ children, className, lift = -2, ...rest }: HTMLMotionProps<'div'> & { children: ReactNode; lift?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { y: lift }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.6 }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
