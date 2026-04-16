import { useState } from 'react';
import Card from '../components/Card';
import { Upload, Mic, Sparkles, Gamepad2 } from 'lucide-react';
import UploadModal from '../components/UploadModal';
import VoiceCaptureModal from '../components/VoiceCaptureModal';
import MotorGame from '../components/MotorGame';
import { motion } from 'framer-motion';

const testOptions = [
  {
    id: 'voice',
    title: 'Capture Voice',
    description: 'Record a 30-120s audio sample.',
    icon: Mic,
    colorClass: 'text-primary bg-primary/10 group-hover:bg-primary group-hover:text-primary-foreground',
  },
  {
    id: 'upload-spiral',
    title: 'Upload Spiral',
    description: 'Upload a spiral drawing image.',
    icon: Upload,
    colorClass: 'text-secondary bg-secondary/10 group-hover:bg-secondary group-hover:text-secondary-foreground',
  },
  {
    id: 'upload-wave',
    title: 'Upload Wave',
    description: 'Upload a wave drawing image.',
    icon: Upload,
    colorClass: 'text-primary bg-primary/10 group-hover:bg-primary group-hover:text-primary-foreground',
  },
  {
    id: 'motor-game',
    title: 'Motor Skill Test',
    description: 'Try the 10-second tracing game to evaluate motor control.',
    icon: Gamepad2,
    colorClass: 'text-accent-foreground bg-accent-foreground/10 group-hover:bg-accent-foreground group-hover:text-background',
  },
];

const NewTest = () => {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const openModal = (id: string) => {
    setActiveModal(id);
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  return (
    <div className="space-y-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-3xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-[2rem] bg-primary/10 p-3">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-5xl font-serif font-bold tracking-tight text-foreground">Start a New Test</h2>
        </div>
        <p className="text-xl leading-relaxed text-muted-foreground">
          Choose a method to provide data for analysis. Real-time capture provides the most authentic tactile data, while uploading allows for historical processing.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 items-stretch gap-8 md:grid-cols-2 xl:grid-cols-4">
        {testOptions.map((option, index) => (
          <motion.div
            key={option.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1, ease: 'easeOut' }}
            className="h-full"
          >
            <Card
              onClick={() => openModal(option.id)}
              className={`group relative h-full min-h-[22rem] cursor-pointer overflow-hidden rounded-organic-${(index % 4) + 1} bg-white/70 p-8 text-center transition-all duration-500 hover:border-primary/30`}
            >
              <div className="relative z-10 flex h-full flex-col items-center justify-center">
                <div className={`mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-[2rem] transition-colors duration-400 ${option.colorClass}`}>
                  <option.icon className="h-8 w-8" />
                </div>
                {option.id === 'motor-game' && (
                  <span className="mb-3 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                    Try now
                  </span>
                )}
                <h3 className="mb-4 text-2xl font-serif font-bold text-foreground transition-colors group-hover:text-primary">
                  {option.title}
                </h3>
                <p className="max-w-[15rem] text-base font-medium leading-relaxed text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {activeModal === 'upload-spiral' && <UploadModal onClose={closeModal} uploadType="spiral" />}
      {activeModal === 'upload-wave' && <UploadModal onClose={closeModal} uploadType="wave" />}
      {activeModal === 'voice' && <VoiceCaptureModal onClose={closeModal} />}
      {activeModal === 'motor-game' && <MotorGame onClose={closeModal} />}
    </div>
  );
};

export default NewTest;
