import React from 'react';
import { motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';

type CardProps = HTMLMotionProps<'div'> & {
  children: React.ReactNode;
  className?: string;
};

const Card = ({ children, className = '', ...rest }: CardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
      className={`bg-white border border-gray-200 rounded-2xl shadow-md hover:shadow-xl p-6 transition-all ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
};

export default Card;
