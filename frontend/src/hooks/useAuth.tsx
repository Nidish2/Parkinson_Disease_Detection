import React, { createContext, useState, useContext, useEffect } from 'react';
import { mongodb } from '../lib/mongodbClient';
import { Profile } from '../types/database';

// MongoDB-compatible User and Session types
interface User {
  id: string;
  email: string;
  full_name?: string;
}

interface Session {
  user: User;
  access_token: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await mongodb
        .from('patient_profiles')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.warn('Error fetching profile from MongoDB:', error);
        // Try localStorage fallback
        const localProfile = localStorage.getItem('user_profile');
        if (localProfile) {
          const parsedProfile = JSON.parse(localProfile);
          if (parsedProfile.id === userId) {
            console.log('✅ Loaded profile from localStorage');
            setProfile(parsedProfile);
            return parsedProfile;
          }
        }
      } else if (data) {
        setProfile(data);
        // Update localStorage cache
        localStorage.setItem('user_profile', JSON.stringify(data));
        return data;
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
      // Try localStorage as last resort
      const localProfile = localStorage.getItem('user_profile');
      if (localProfile) {
        const parsedProfile = JSON.parse(localProfile);
        if (parsedProfile.id === userId) {
          setProfile(parsedProfile);
          return parsedProfile;
        }
      }
    }
    return null;
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }

  useEffect(() => {
    // Set a timeout to ensure loading doesn't hang forever
    const timeout = setTimeout(() => {
      console.log('Auth loading timeout - setting loading to false');
      setLoading(false);
    }, 2000);

    // Check for existing session immediately
    mongodb.getSession().then(({ data, error }) => {
      if (error) {
        console.error('Error getting session:', error);
        setUser(null);
        setSession(null);
        setProfile(null);
        clearTimeout(timeout);
        setLoading(false);
        return;
      }
      
      const currentUser = data?.user ?? null;
      const sessionData = data ? {
        user: data.user,
        access_token: mongodb.getToken() || '',
      } : null;
      
      setSession(sessionData as Session | null);
      setUser(currentUser);

      if (currentUser) {
        fetchProfile(currentUser.id).finally(() => {
          clearTimeout(timeout);
          setLoading(false);
        });
      } else {
        setProfile(null);
        clearTimeout(timeout);
        setLoading(false);
      }
    });

    // Poll for auth state changes (MongoDB doesn't have real-time subscriptions)
    const pollInterval = setInterval(() => {
      mongodb.getSession().then(({ data, error }) => {
        if (!error && data) {
          const currentUser = data.user;
          const sessionData = {
            user: currentUser,
            access_token: mongodb.getToken() || '',
          };
          setSession(sessionData as Session);
          setUser(currentUser);
          if (currentUser) {
            fetchProfile(currentUser.id);
          }
        } else {
          setUser(null);
          setSession(null);
          setProfile(null);
        }
        setLoading(false);
      });
    }, 5000); // Poll every 5 seconds

    // Cleanup
    return () => {
      clearTimeout(timeout);
      clearInterval(pollInterval);
    };
  }, []);

  const logout = async () => {
    try {
      // Clear all localStorage data
      localStorage.removeItem('user_profile');
      localStorage.removeItem('dashboard_cache');
      localStorage.removeItem('local_tests');
      localStorage.removeItem('local_test_results');
      
      // Sign out from MongoDB
      await mongodb.signOut();
      
      // Clear state immediately
      setUser(null);
      setProfile(null);
      setSession(null);
      
      // Redirect to login page
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout failed:', error);
      // Force redirect even if error
      window.location.href = '/login';
    }
  };

  const value = {
    user,
    profile,
    session,
    loading,
    logout,
    refreshProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
