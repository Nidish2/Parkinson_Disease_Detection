"""
MongoDB Service for Parkinson's Care App
Handles all database operations, authentication, and file storage
"""

from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, OperationFailure
from bson import ObjectId
from bson.json_util import dumps, loads
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from jose import jwt, JWTError
import os
from dotenv import load_dotenv
import gridfs
import base64

load_dotenv()

# MongoDB connection
MONGODB_URI = os.getenv('MONGODB_URI')
DATABASE_NAME = os.getenv('DATABASE_NAME', 'parkinsons_care')
JWT_SECRET = os.getenv('JWT_SECRET', 'your-secret-key-change-in-production')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24

class MongoDBService:
    def __init__(self):
        try:
            self.client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
            # Test connection
            self.client.admin.command('ping')
            print(f"✅ Connected to MongoDB: {DATABASE_NAME}")
            self.db = self.client[DATABASE_NAME]
            self.fs = gridfs.GridFS(self.db)
            self._ensure_indexes()
        except Exception as e:
            print(f"⚠️ MongoDB connection error: {e}")
            print(f"   URI: {MONGODB_URI}")
            print(f"   Database: {DATABASE_NAME}")
            print("   Make sure MongoDB is running or check your connection string")
            raise
    
    def _ensure_indexes(self):
        """Create indexes for better query performance"""
        # Users collection
        self.db.users.create_index('email', unique=True)
        self.db.users.create_index('patient_id')
        
        # Tests collection
        self.db.tests.create_index('patient_id')
        self.db.tests.create_index('created_at')
        
        # Appointments collection
        self.db.appointments.create_index('patient_id')
        self.db.appointments.create_index('appointment_date')
        
        # Reports collection
        self.db.reports.create_index('patient_id')
        self.db.reports.create_index('test_id')
    
    def _to_dict(self, doc):
        """Convert MongoDB document to dict, handling ObjectId"""
        if doc is None:
            return None
        if isinstance(doc, ObjectId):
            return str(doc)
        if isinstance(doc, dict):
            result = {}
            for key, value in doc.items():
                if isinstance(value, ObjectId):
                    result[key] = str(value)
                elif isinstance(value, datetime):
                    result[key] = value.isoformat()
                else:
                    result[key] = value
            return result
        return doc
    
    # Authentication methods
    def create_user(self, email: str, password: str, full_name: str = None):
        """Create a new user"""
        try:
            user_doc = {
                'email': email,
                'password_hash': generate_password_hash(password),
                'full_name': full_name,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            }
            result = self.db.users.insert_one(user_doc)
            
            # Create patient profile
            profile_doc = {
                'id': str(result.inserted_id),
                'patient_id': str(result.inserted_id),
                'full_name': full_name,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            }
            self.db.patient_profiles.insert_one(profile_doc)
            
            return {
                'id': str(result.inserted_id),
                'email': email,
                'full_name': full_name,
            }
        except DuplicateKeyError:
            raise ValueError('User with this email already exists')
    
    def authenticate_user(self, email: str, password: str):
        """Authenticate user and return user data"""
        user = self.db.users.find_one({'email': email})
        if not user:
            return None
        
        if not check_password_hash(user['password_hash'], password):
            return None
        
        return {
            'id': str(user['_id']),
            'email': user['email'],
            'full_name': user.get('full_name'),
        }
    
    def generate_token(self, user_id: str, email: str):
        """Generate JWT token"""
        expires = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
        payload = {
            'user_id': user_id,
            'email': email,
            'exp': expires,
            'iat': datetime.utcnow(),
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    def verify_token(self, token: str):
        """Verify JWT token and return user data"""
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get('user_id')
            user = self.db.users.find_one({'_id': ObjectId(user_id)})
            if user:
                return {
                    'id': str(user['_id']),
                    'email': user['email'],
                    'full_name': user.get('full_name'),
                }
        except JWTError:
            pass
        return None
    
    # Database operations
    def find_one(self, collection: str, filter_dict: dict, user_id: str = None):
        """Find one document"""
        # Add user filter if user_id provided
        if user_id and 'patient_id' in self._get_collection_schema(collection):
            filter_dict['patient_id'] = user_id
        
        doc = self.db[collection].find_one(filter_dict)
        return self._to_dict(doc)
    
    def find_many(self, collection: str, filter_dict: dict = None, user_id: str = None, 
                  order_by: str = None, order_direction: str = 'asc', limit: int = None):
        """Find multiple documents"""
        if filter_dict is None:
            filter_dict = {}
        
        # Add user filter if user_id provided
        if user_id and 'patient_id' in self._get_collection_schema(collection):
            filter_dict['patient_id'] = user_id
        
        query = self.db[collection].find(filter_dict)
        
        if order_by:
            direction = -1 if order_direction == 'desc' else 1
            query = query.sort(order_by, direction)
        
        if limit:
            query = query.limit(limit)
        
        docs = list(query)
        return [self._to_dict(doc) for doc in docs]
    
    def insert_one(self, collection: str, data: dict, user_id: str = None):
        """Insert one document"""
        # Add timestamps
        data['created_at'] = datetime.utcnow()
        data['updated_at'] = datetime.utcnow()
        
        # Add user_id if provided
        if user_id and 'patient_id' in self._get_collection_schema(collection):
            data['patient_id'] = user_id
        
        # Convert string IDs to ObjectId if needed
        if 'id' in data and data['id']:
            data['_id'] = ObjectId(data['id'])
            del data['id']
        
        result = self.db[collection].insert_one(data)
        data['id'] = str(result.inserted_id)
        return self._to_dict(data)
    
    def insert_many(self, collection: str, data_list: list, user_id: str = None):
        """Insert multiple documents"""
        for data in data_list:
            data['created_at'] = datetime.utcnow()
            data['updated_at'] = datetime.utcnow()
            
            if user_id and 'patient_id' in self._get_collection_schema(collection):
                data['patient_id'] = user_id
            
            if 'id' in data and data['id']:
                data['_id'] = ObjectId(data['id'])
                del data['id']
        
        result = self.db[collection].insert_many(data_list)
        return [str(id) for id in result.inserted_ids]
    
    def update_one(self, collection: str, filter_dict: dict, updates: dict, user_id: str = None):
        """Update one document"""
        # Add user filter if user_id provided
        if user_id and 'patient_id' in self._get_collection_schema(collection):
            filter_dict['patient_id'] = user_id
        
        updates['updated_at'] = datetime.utcnow()
        result = self.db[collection].update_one(filter_dict, {'$set': updates})
        return result.modified_count > 0
    
    def delete_one(self, collection: str, filter_dict: dict, user_id: str = None):
        """Delete one document"""
        # Add user filter if user_id provided
        if user_id and 'patient_id' in self._get_collection_schema(collection):
            filter_dict['patient_id'] = user_id
        
        result = self.db[collection].delete_one(filter_dict)
        return result.deleted_count > 0
    
    def _get_collection_schema(self, collection: str):
        """Get schema fields for a collection"""
        schemas = {
            'tests': ['patient_id'],
            'appointments': ['patient_id'],
            'reports': ['patient_id'],
            'orders': ['patient_id'],
            'patient_profiles': ['id', 'patient_id'],
        }
        return schemas.get(collection, [])
    
    # File storage methods
    def upload_file(self, bucket: str, path: str, file_data: bytes, user_id: str = None):
        """Upload file to GridFS"""
        metadata = {
            'bucket': bucket,
            'path': path,
            'user_id': user_id,
            'uploaded_at': datetime.utcnow(),
        }
        file_id = self.fs.put(file_data, filename=path, metadata=metadata)
        return {
            'id': str(file_id),
            'path': path,
            'bucket': bucket,
        }
    
    def get_file(self, file_id: str):
        """Get file from GridFS"""
        try:
            file_data = self.fs.get(ObjectId(file_id))
            return file_data.read()
        except Exception:
            return None
    
    def get_file_by_path(self, bucket: str, path: str):
        """Get file by path"""
        file_doc = self.fs.find_one({'metadata.bucket': bucket, 'filename': path})
        if file_doc:
            return file_doc.read()
        return None

# Global instance
mongodb_service = MongoDBService()

