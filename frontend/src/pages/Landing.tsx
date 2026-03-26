import { Link } from 'react-router-dom';
import { BrainCircuit, ShieldCheck, TestTube, MessageSquare, ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

const FeatureCard = ({ icon, title, description, delay }: { icon: React.ElementType, title: string, description: string, delay: number }) => {
    const Icon = icon;
    return (
        <motion.div 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay }}
            whileHover={{ y: -8, transition: { duration: 0.3 } }}
            className="bg-white p-8 rounded-2xl text-center shadow-md hover:shadow-xl transition-all group cursor-pointer border border-gray-100"
        >
            <div className="bg-blue-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-100 transition-colors">
                <Icon className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold mb-3 text-gray-900 group-hover:text-blue-600 transition-colors">{title}</h3>
            <p className="text-gray-600 leading-relaxed">{description}</p>
        </motion.div>
    );
}

const Landing = () => {
  return (
    <div className="min-h-screen bg-white overflow-hidden">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-20 lg:py-32">
        <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-center max-w-5xl mx-auto"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="inline-flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-full mb-6 border border-blue-100"
          >
            <Sparkles className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-blue-600">Powered by Advanced AI</span>
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="text-5xl lg:text-7xl font-bold mb-6 text-gray-900 leading-tight"
          >
            Health. Powered by <span className="text-blue-600">NeuroCare</span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="text-xl lg:text-2xl text-gray-600 max-w-3xl mx-auto mb-10 leading-relaxed"
          >
            Advanced AI-powered detection and personalized care for Parkinson's disease. Take control of your health journey with confidence.
          </motion.p>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link 
              to="/login" 
              className="group bg-blue-600 text-white font-semibold px-8 py-4 rounded-xl hover:bg-blue-700 hover:shadow-xl transition-all flex items-center gap-2 text-lg"
            >
              Get Started
              <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a 
              href="#features" 
              className="font-semibold px-8 py-4 rounded-xl border-2 border-gray-300 hover:border-blue-600 hover:bg-gray-50 transition-all text-lg text-gray-700"
            >
              Learn More
            </a>
          </motion.div>
        </motion.div>

        {/* Floating Animation Background */}
        <motion.div
          animate={{ 
            y: [0, -20, 0],
            rotate: [0, 5, 0]
          }}
          transition={{ 
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute top-20 right-10 w-32 h-32 bg-blue-100 rounded-full blur-3xl opacity-60"
        />
        <motion.div
          animate={{ 
            y: [0, 20, 0],
            rotate: [0, -5, 0]
          }}
          transition={{ 
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1
          }}
          className="absolute bottom-20 left-10 w-40 h-40 bg-purple-100 rounded-full blur-3xl opacity-60"
        />
      </div>

      {/* Features Section */}
      <div id="features" className="bg-gradient-to-b from-white to-gray-50 py-20">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold mb-4 text-gray-900">Everything you need for better health</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Comprehensive tools and insights to support your health journey
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              <FeatureCard 
                icon={TestTube} 
                title="AI-Powered Analysis" 
                description="Advanced machine learning models analyze voice, handwriting, and movement patterns for accurate early detection." 
                delay={0.2}
              />
              <FeatureCard 
                icon={ShieldCheck} 
                title="Secure & Private" 
                description="Your health data is protected with bank-grade encryption. You maintain complete control of your information." 
                delay={0.3}
              />
              <FeatureCard 
                icon={MessageSquare} 
                title="Comprehensive Care" 
                description="From diagnosis to daily management, access reports, consult specialists, and get AI-powered assistance." 
                delay={0.4}
              />
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <motion.div 
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto px-4 py-20"
      >
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-3xl p-12 lg:p-16 text-center shadow-2xl">
          <h2 className="text-4xl lg:text-5xl font-bold mb-6 text-white">Ready to take control of your health?</h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Join thousands of users who trust NeuroCare for their Parkinson's health management
          </p>
          <Link 
            to="/login" 
            className="inline-flex items-center gap-2 bg-white text-blue-600 font-semibold px-10 py-5 rounded-xl hover:bg-gray-50 hover:shadow-xl transition-all text-lg group"
          >
            Start Your Journey
            <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default Landing;
