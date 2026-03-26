import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export interface MongoDBResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}

export interface User {
  id: string;
  email: string;
  full_name?: string;
  created_at: string;
}

export interface Session {
  user: User;
  access_token: string;
  expires_at: number;
}

class MongoDBClient {
  private baseURL: string;
  private token: string | null = null;

  constructor() {
    this.baseURL = API_BASE_URL;
    // Load token from localStorage
    const storedToken = localStorage.getItem('mongodb_token');
    if (storedToken) {
      this.token = storedToken;
    }
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('mongodb_token', token);
  }

  getToken(): string | null {
    return this.token || localStorage.getItem('mongodb_token');
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('mongodb_token');
  }

  // Auth methods
  async signUp(email: string, password: string, fullName?: string): Promise<MongoDBResponse<Session>> {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/signup`, {
        email,
        password,
        full_name: fullName,
      });
      if (response.data.data?.access_token) {
        this.setToken(response.data.data.access_token);
      }
      return response.data;
    } catch (error: any) {
      return {
        error: error.response?.data?.error || error.message || 'Sign up failed',
      };
    }
  }

  async signIn(email: string, password: string): Promise<MongoDBResponse<Session>> {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/signin`, {
        email,
        password,
      });
      if (response.data.data?.access_token) {
        this.setToken(response.data.data.access_token);
      }
      return response.data;
    } catch (error: any) {
      return {
        error: error.response?.data?.error || error.message || 'Sign in failed',
      };
    }
  }

  async signOut(): Promise<MongoDBResponse> {
    try {
      await axios.post(`${this.baseURL}/api/auth/signout`, {}, {
        headers: this.getHeaders(),
      });
      this.clearToken();
      return { message: 'Signed out successfully' };
    } catch (error: any) {
      this.clearToken();
      return {
        error: error.response?.data?.error || error.message || 'Sign out failed',
      };
    }
  }

  async getSession(): Promise<MongoDBResponse<Session>> {
    try {
      const response = await axios.get(`${this.baseURL}/api/auth/session`, {
        headers: this.getHeaders(),
      });
      return response.data;
    } catch (error: any) {
      return {
        error: error.response?.data?.error || error.message || 'Failed to get session',
      };
    }
  }

  // Database methods (similar to Supabase API for compatibility)
  from(collection: string) {
    // Create a query builder class
    class QueryBuilder {
      private collection: string;
      private client: MongoDBClient;
      private queryParams: any = {};
      private filterParams: any = {};

      constructor(collection: string, client: MongoDBClient) {
        this.collection = collection;
        this.client = client;
      }

      select(columns?: string) {
        this.queryParams.columns = columns;
        return this;
      }

      eq(column: string, value: any) {
        this.filterParams[column] = value;
        return this;
      }

      order(column: string, options?: { ascending?: boolean }) {
        this.queryParams.orderBy = column;
        this.queryParams.orderDirection = options?.ascending === false ? 'desc' : 'asc';
        return this;
      }

      single() {
        this.queryParams.single = true;
        return this;
      }

      // Make it awaitable
      async then(resolve?: (value: any) => any, reject?: (reason?: any) => any) {
        try {
          const params: any = { ...this.queryParams };
          if (Object.keys(this.filterParams).length > 0) {
            params.filter = JSON.stringify(this.filterParams);
          }
          
          const response = await axios.get(`${this.client.baseURL}/api/db/${this.collection}`, {
            headers: this.client.getHeaders(),
            params,
          });
          const result = { data: response.data.data || [], error: null };
          return resolve ? resolve(result) : Promise.resolve(result);
        } catch (error: any) {
          const result = {
            data: null,
            error: { message: error.response?.data?.error || error.message },
          };
          if (reject) {
            return reject(result);
          }
          return Promise.reject(result);
        }
      }

      async catch(reject?: (reason?: any) => any) {
        try {
          const params: any = { ...this.queryParams };
          if (Object.keys(this.filterParams).length > 0) {
            params.filter = JSON.stringify(this.filterParams);
          }
          
          const response = await axios.get(`${this.client.baseURL}/api/db/${this.collection}`, {
            headers: this.client.getHeaders(),
            params,
          });
          return { data: response.data.data || [], error: null };
        } catch (error: any) {
          const result = {
            data: null,
            error: { message: error.response?.data?.error || error.message },
          };
          return reject ? reject(result) : result;
        }
      }
    }

    return {
      // Chainable query builder
      select: (columns?: string) => {
        const builder = new QueryBuilder(collection, this);
        return builder.select(columns);
      },

      eq: (column: string, value: any) => {
        const builder = new QueryBuilder(collection, this);
        return builder.eq(column, value);
      },

      order: (column: string, options?: { ascending?: boolean }) => {
        const builder = new QueryBuilder(collection, this);
        return builder.order(column, options);
      },

      // Direct insert
      insert: async (data: any | any[]) => {
        try {
          const response = await axios.post(`${this.baseURL}/api/db/${collection}`, {
            data: Array.isArray(data) ? data : [data],
          }, {
            headers: this.getHeaders(),
          });
          return { data: response.data.data || [], error: null };
        } catch (error: any) {
          return {
            data: null,
            error: { message: error.response?.data?.error || error.message },
          };
        }
      },

      update: async (updates: any) => {
        try {
          const response = await axios.patch(`${this.baseURL}/api/db/${collection}`, {
            updates,
          }, {
            headers: this.getHeaders(),
          });
          return { data: response.data.data || [], error: null };
        } catch (error: any) {
          return {
            data: null,
            error: { message: error.response?.data?.error || error.message },
          };
        }
      },

      delete: async () => {
        try {
          const response = await axios.delete(`${this.baseURL}/api/db/${collection}`, {
            headers: this.getHeaders(),
          });
          return { data: response.data.data || [], error: null };
        } catch (error: any) {
          return {
            data: null,
            error: { message: error.response?.data?.error || error.message },
          };
        }
      },
    };
  }

  // Storage methods (using GridFS or file storage)
  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, file: Blob | File, options?: any) => {
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('path', path);
          formData.append('bucket', bucket);

          const response = await axios.post(`${this.baseURL}/api/storage/upload`, formData, {
            headers: {
              ...this.getHeaders(),
              'Content-Type': 'multipart/form-data',
            },
          });
          return { data: response.data.data, error: null };
        } catch (error: any) {
          return {
            data: null,
            error: { message: error.response?.data?.error || error.message },
          };
        }
      },
      getPublicUrl: (path: string) => {
        return `${this.baseURL}/api/storage/${bucket}/${path}`;
      },
    }),
  };

  // Realtime subscriptions (simplified - using polling or WebSocket)
  channel(name: string) {
    const subscriptions: Array<{ event: string; callback: (payload: any) => void }> = [];
    
    const createChainable = () => ({
      on: (event: string, config: any, callback?: (payload: any) => void) => {
        if (callback) {
          subscriptions.push({ event, callback });
        }
        // Return chainable object
        return createChainable();
      },
      subscribe: () => ({
        data: {
          subscription: {
            unsubscribe: () => {
              subscriptions.length = 0;
            },
          },
        },
      }),
    });
    
    return createChainable();
  }

  removeChannel(channel: any) {
    // Cleanup if needed
  }
}

export const mongodb = new MongoDBClient();
