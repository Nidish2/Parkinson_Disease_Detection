import { useState } from 'react';
import Card from '../components/Card';
import { Upload, Mic, PenTool, Video, Sparkles } from 'lucide-react';
import UploadModal from '../components/UploadModal';
import VoiceCaptureModal from '../components/VoiceCaptureModal';
import ImageCaptureModal from '../components/ImageCaptureModal';
import { motion } from 'framer-motion';

const testOptions = [
    { id: 'voice', title: 'Capture Voice', description: 'Record a 30-120s audio sample.', icon: Mic, type: 'speech', gradient: 'from-purple-500/20 to-purple-600/10' },
    { id: 'spiral', title: 'Capture Spiral', description: 'Photograph a spiral drawing.', icon: PenTool, type: 'spiral', gradient: 'from-blue-500/20 to-blue-600/10' },
    { id: 'wave', title: 'Capture Wave', description: 'Photograph a wave drawing.', icon: PenTool, type: 'wave', gradient: 'from-cyan-500/20 to-cyan-600/10' },
    { id: 'video', title: 'Capture Face Video', description: 'Record a 2-minute video for vitals estimation.', icon: Video, type: 'video', gradient: 'from-green-500/20 to-green-600/10' },
    { id: 'upload-spiral', title: 'Upload Spiral', description: 'Upload a spiral drawing image.', icon: Upload, type: 'spiral', gradient: 'from-indigo-500/20 to-indigo-600/10' },
    { id: 'upload-wave', title: 'Upload Wave', description: 'Upload a wave drawing image.', icon: Upload, type: 'wave', gradient: 'from-teal-500/20 to-teal-600/10' },
];

const NewTest = () => {
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [activeTestType, setActiveTestType] = useState<string>('upload');

  const openModal = (id: string, type: string) => {
      setActiveModal(id);
      setActiveTestType(type);
  }

  const closeModal = () => {
      setActiveModal(null);
  }

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <Sparkles className="h-8 w-8 text-blue-600" />
          <h2 className="text-4xl font-bold text-gray-900">Start a New Test</h2>
        </div>
        <p className="text-gray-600 text-lg max-w-3xl leading-relaxed">
          Choose a method to provide data for analysis. Real-time capture provides the most accurate environmental data, but you can also upload existing files.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {testOptions.map((option, index) => (
            <motion.div
              key={option.title}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ y: -8, transition: { duration: 0.2 } }}
            >
              <Card 
                onClick={() => openModal(option.id, option.type)} 
                className={`text-center hover:border-blue-500 transition-all cursor-pointer p-8 bg-gradient-to-br ${option.gradient} hover:shadow-2xl group relative overflow-hidden`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-blue-50 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="bg-blue-50 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 group-hover:bg-blue-100 transition-all">
                    <option.icon className="h-10 w-10 text-blue-600" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-gray-900 group-hover:text-blue-600 transition-colors">{option.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{option.description}</p>
                </div>
              </Card>
            </motion.div>
        ))}
      </div>

      {activeModal === 'upload-spiral' && <UploadModal onClose={closeModal} uploadType="spiral" />}
      {activeModal === 'upload-wave' && <UploadModal onClose={closeModal} uploadType="wave" />}
      {activeModal === 'voice' && <VoiceCaptureModal onClose={closeModal} />}
      {(activeModal === 'spiral' || activeModal === 'wave' || activeModal === 'video') && <ImageCaptureModal onClose={closeModal} testType={activeTestType} />}

    </div>
  );
};

export default NewTest;
