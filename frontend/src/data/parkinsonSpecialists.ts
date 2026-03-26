export type AppointmentSlot = {
  day: string;
  times: string[];
};

export interface Doctor {
  id: string;
  name: string;
  title: string;
  yearsExperience: number;
  hospital: string;
  location: string;
  state: string;
  specialties: string[];
  languages: string[];
  phone: string;
  videoUrl?: string;
  tags: string[];
  nextSlots: AppointmentSlot[];
  bio: string;
}

export const parkinsonSpecialists: Doctor[] = [
  {
    id: 'delhi-aiims-nr',
    name: 'Dr. Nandita Rao',
    title: 'Senior Consultant Neurologist',
    yearsExperience: 18,
    hospital: 'All India Institute of Medical Sciences (AIIMS)',
    location: 'New Delhi',
    state: 'Delhi NCR',
    specialties: ['Movement Disorders', 'Deep Brain Stimulation (DBS)', 'Medication Optimisation'],
    languages: ['English', 'Hindi'],
    phone: '+911126593000',
    videoUrl: 'https://aiims.edu',
    tags: ['Hospital-based', 'DBS', 'Complex cases'],
    nextSlots: [
      { day: 'Tuesday', times: ['10:30 AM', '11:45 AM'] },
      { day: 'Friday', times: ['2:00 PM', '3:15 PM'] },
    ],
    bio: 'Leads the Parkinson’s care programme at AIIMS with a focus on advanced symptom management and DBS candidacy assessments.'
  },
  {
    id: 'mumbai-nh-ks',
    name: 'Dr. Kartik Sundaram',
    title: 'Consultant Neurologist & Parkinson’s Specialist',
    yearsExperience: 15,
    hospital: 'Jaslok Hospital & Research Centre',
    location: 'Mumbai',
    state: 'Maharashtra',
    specialties: ['Parkinson’s Plus Syndromes', 'Gait & Balance Clinics', 'Tele-neurology'],
    languages: ['English', 'Hindi', 'Marathi'],
    phone: '+912266555555',
    videoUrl: 'https://jaslokhospital.net',
    tags: ['In-person & Telehealth', 'Care-partner coaching'],
    nextSlots: [
      { day: 'Monday', times: ['5:00 PM', '6:00 PM'] },
      { day: 'Thursday', times: ['9:30 AM', '10:30 AM'] },
    ],
    bio: 'Runs a multidisciplinary clinic combining physiotherapy, speech therapy, and medication review for people living with Parkinson’s.'
  },
  {
    id: 'blr-nimhans-sn',
    name: 'Dr. Shreya Nambiar',
    title: 'Associate Professor of Neurology',
    yearsExperience: 12,
    hospital: 'NIMHANS Parkinson’s & Movement Disorders Centre',
    location: 'Bengaluru',
    state: 'Karnataka',
    specialties: ['Young-onset Parkinson’s', 'Neuro-rehabilitation', 'Non-motor symptoms'],
    languages: ['English', 'Kannada', 'Malayalam'],
    phone: '+918026995401',
    tags: ['Multidisciplinary', 'Research-backed care'],
    nextSlots: [
      { day: 'Wednesday', times: ['11:00 AM', '12:30 PM'] },
      { day: 'Saturday', times: ['10:00 AM'] },
    ],
    bio: 'Helps patients build personalised wellness plans that combine medication adjustment with physiotherapy and cognitive exercises.'
  },
  {
    id: 'hyd-apollo-rp',
    name: 'Dr. Rohan Patel',
    title: 'Movement Disorders Specialist',
    yearsExperience: 17,
    hospital: 'Apollo Hospitals Jubilee Hills',
    location: 'Hyderabad',
    state: 'Telangana',
    specialties: ['Botulinum toxin therapy', 'Sleep disturbances', 'Advanced medication scheduling'],
    languages: ['English', 'Hindi', 'Telugu', 'Gujarati'],
    phone: '+914023600200',
    videoUrl: 'https://www.apollohospitals.com',
    tags: ['Tele-consult available', 'Sleep clinic'],
    nextSlots: [
      { day: 'Tuesday', times: ['6:30 PM'] },
      { day: 'Friday', times: ['8:30 AM', '9:15 AM'] },
    ],
    bio: 'Focuses on advanced medication titration and supportive therapies to manage fluctuating symptoms and sleep issues.'
  },
  {
    id: 'chennai-ghl-an',
    name: 'Dr. Amala Narayanan',
    title: 'Lead Neurologist, Movement Sciences',
    yearsExperience: 14,
    hospital: 'Gleneagles Global Health City',
    location: 'Chennai',
    state: 'Tamil Nadu',
    specialties: ['Parkinson’s rehabilitation', 'Care-partner training', 'Nutrition for neuroprotection'],
    languages: ['English', 'Tamil'],
    phone: '+914466656666',
    tags: ['Holistic programmes', 'Family education'],
    nextSlots: [
      { day: 'Monday', times: ['10:00 AM', '11:15 AM'] },
      { day: 'Thursday', times: ['4:30 PM'] },
    ],
    bio: 'Designs integrated rehabilitation roadmaps combining dieticians, occupational therapists, and Parkinson’s nurses.'
  },
  {
    id: 'pune-sahyadri-vk',
    name: 'Dr. Vaibhav Kulkarni',
    title: 'Consultant Neurologist',
    yearsExperience: 11,
    hospital: 'Sahyadri Super Speciality Hospital',
    location: 'Pune',
    state: 'Maharashtra',
    specialties: ['Early diagnosis', 'Lifestyle programme design', 'Speech & swallowing therapy'],
    languages: ['English', 'Hindi', 'Marathi'],
    phone: '+912030500500',
    tags: ['Community clinics', 'Speech therapy focus'],
    nextSlots: [
      { day: 'Wednesday', times: ['5:30 PM'] },
      { day: 'Saturday', times: ['12:00 PM', '12:45 PM'] },
    ],
    bio: 'Guides early-stage patients and their families through lifestyle adjustments and speech therapy routines.'
  },
  {
    id: 'kolkata-amri-ss',
    name: 'Dr. Sahana Sen',
    title: 'Senior Consultant Neurologist',
    yearsExperience: 19,
    hospital: 'AMRI Hospitals',
    location: 'Kolkata',
    state: 'West Bengal',
    specialties: ['Neuropsychology of Parkinson’s', 'Rem behaviour disorder', 'Caregiver support'],
    languages: ['English', 'Bengali'],
    phone: '+913366212000',
    tags: ['Caregiver counselling', 'Non-motor focus'],
    nextSlots: [
      { day: 'Friday', times: ['1:00 PM', '2:00 PM'] },
      { day: 'Sunday', times: ['10:30 AM'] },
    ],
    bio: 'Works closely with neuropsychologists to address cognitive changes and caregiver burnout alongside motor symptom care.'
  },
];

export const getDoctorById = (id: string) => parkinsonSpecialists.find((doctor) => doctor.id === id);
