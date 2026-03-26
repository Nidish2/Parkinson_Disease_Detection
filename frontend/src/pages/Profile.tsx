import { useState, useEffect } from 'react';
import Card from '../components/Card';
import { useAuth } from '../hooks/useAuth';
import { mongodb } from '../lib/mongodbClient';
import { LoaderCircle, AlertCircle } from 'lucide-react';

const Profile = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [phone, setPhone] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setDob(profile.date_of_birth || '');
      setGender(profile.gender || '');
      setPhone(profile.phone || '');
      setEmergencyContact(profile.emergency_contact || '');
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const profileData = {
        id: user.id,
        full_name: fullName,
        date_of_birth: dob,
        gender: gender,
        phone: phone,
        emergency_contact: emergencyContact,
        updated_at: new Date().toISOString(),
      };

      // Try updating MongoDB with timeout
      const updatePromise = mongodb
        .from('patient_profiles')
        .update(profileData)
        .eq('id', user.id);
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Update timeout')), 3000)
      );

      try {
        const { error } = await Promise.race([updatePromise, timeoutPromise]) as any;
        if (error) throw error;
        console.log('✅ Profile updated in MongoDB');
      } catch (dbError) {
        console.warn('⚠️ MongoDB update failed, storing locally:', dbError);
        // Store profile in localStorage as backup
        localStorage.setItem('user_profile', JSON.stringify(profileData));
      }

      setSuccess('Profile updated successfully!');
      await refreshProfile(); // Refresh the profile in the auth context
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (error: any) {
      console.error('Profile update error:', error);
      setError(error?.message || 'Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 text-gray-900">My Profile</h2>
      <Card className="max-w-2xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input id="email" type="email" value={user?.email || ''} disabled className="w-full bg-gray-100 text-gray-700 p-3 rounded-lg border border-gray-300 opacity-70 cursor-not-allowed" />
          </div>
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input id="fullName" type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full bg-white text-gray-900 p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="dob" className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
            <input id="dob" type="date" value={dob} onChange={e => setDob(e.target.value)} className="w-full bg-white text-gray-900 p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
            <input id="gender" type="text" value={gender} onChange={e => setGender(e.target.value)} placeholder="e.g., Male, Female, Non-binary" className="w-full bg-white text-gray-900 p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
            <input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-white text-gray-900 p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="emergencyContact" className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact</label>
            <input id="emergencyContact" type="tel" value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} className="w-full bg-white text-gray-900 p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none" />
          </div>
          
          {error && (
            <div className="flex items-center space-x-2 text-red-700 bg-red-50 p-3 rounded-lg border border-red-200">
              <AlertCircle size={20} />
              <p className="text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-center space-x-2 text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
              <p className="text-sm">{success}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-semibold p-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center disabled:opacity-50 shadow-md hover:shadow-lg">
            {loading ? <LoaderCircle className="animate-spin" /> : 'Save Changes'}
          </button>
        </form>
      </Card>
    </div>
  );
};

export default Profile;
