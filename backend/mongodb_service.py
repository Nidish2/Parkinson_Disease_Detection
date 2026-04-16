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
MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/')
DATABASE_NAME = os.getenv('DATABASE_NAME', 'parkinsons_care')
JWT_SECRET = os.getenv('JWT_SECRET', 'your-secret-key-change-in-production')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_MINUTES = 30
DEFAULT_ADMIN_EMAIL = 'admin@neurocare.local'
DEFAULT_ADMIN_PASSWORD = 'NeuroCareAdmin@123'
DEFAULT_ADMIN_NAME = 'NeuroCare Admin'

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
            self._ensure_default_admin_account()
        except Exception as e:
            print(f"⚠️ MongoDB connection error: {e}")
            print(f"   URI: {MONGODB_URI}")
            print(f"   Database: {DATABASE_NAME}")
            print("   Make sure MongoDB is running or check your connection string")
            raise
            
        # In-memory token blocklist for revoked tokens (logouts)
        self.revoked_tokens = set()
    
    def _ensure_indexes(self):
        """Create indexes for better query performance"""
        # Users collection
        self.db.users.create_index('email', unique=True)
        self.db.users.create_index('patient_id')
        self.db.users.create_index('role')
        self.db.users.create_index('approval_status')
        self.db.chat_messages.create_index('appointment_id')
        self.db.chat_messages.create_index('created_at')
        
        # Tests collection
        self.db.tests.create_index('patient_id')
        self.db.tests.create_index('created_at')
        
        # Appointments collection
        self.db.appointments.create_index('patient_id')
        self.db.appointments.create_index('doctor_id')
        self.db.appointments.create_index('report_id')
        self.db.appointments.create_index('status')
        self.db.appointments.create_index('appointment_date')
        
        # Reports collection
        self.db.reports.create_index('patient_id')
        self.db.reports.create_index('test_id')
        self.db.reports.create_index('doctor_id')
        self.db.reports.create_index('status')
    
    def _to_dict(self, doc):
        """Convert MongoDB document to JSON-friendly dict (nested ObjectId/datetime safe)."""
        if doc is None:
            return None
        if isinstance(doc, ObjectId):
            return str(doc)
        if isinstance(doc, datetime):
            return doc.isoformat()
        if isinstance(doc, dict):
            res = {key: self._to_dict(value) for key, value in doc.items()}
            # Map MongoDB _id to frontend id
            if '_id' in res:
                res['id'] = res['_id']
            return res
        if isinstance(doc, list):
            return [self._to_dict(item) for item in doc]
        return doc

    def _normalize_specialties(self, specialties):
        if specialties is None:
            return []
        if isinstance(specialties, list):
            return [str(item).strip() for item in specialties if str(item).strip()]
        if isinstance(specialties, str):
            return [item.strip() for item in specialties.split(',') if item.strip()]
        return []

    def _serialize_user(self, user_doc):
        if not user_doc:
            return None
        return {
            'id': str(user_doc['_id']),
            'email': user_doc['email'],
            'full_name': user_doc.get('full_name'),
            'role': user_doc.get('role', 'patient'),
            'approval_status': user_doc.get('approval_status', 'approved'),
            'phone': user_doc.get('phone'),
            'hospital': user_doc.get('hospital'),
            'specialties': user_doc.get('specialties', []),
            'doctor_identifier': user_doc.get('doctor_identifier'),
            'age': user_doc.get('age'),
            'gender': user_doc.get('gender'),
            'qualification': user_doc.get('qualification'),
            'years_experience': user_doc.get('years_experience'),
            'availability_slots': user_doc.get('availability_slots', []),
            'created_at': user_doc.get('created_at').isoformat() if isinstance(user_doc.get('created_at'), datetime) else user_doc.get('created_at'),
        }

    def _ensure_default_admin_account(self):
        """Seed a hidden default admin account in MongoDB."""
        existing_admin = self.db.users.find_one({'email': DEFAULT_ADMIN_EMAIL})
        admin_payload = {
            'email': DEFAULT_ADMIN_EMAIL,
            'password_hash': generate_password_hash(DEFAULT_ADMIN_PASSWORD),
            'full_name': DEFAULT_ADMIN_NAME,
            'role': 'admin',
            'approval_status': 'approved',
            'phone': None,
            'hospital': 'NeuroCare Central',
            'specialties': ['Platform Administration'],
            'updated_at': datetime.utcnow(),
        }

        if existing_admin:
            self.db.users.update_one({'_id': existing_admin['_id']}, {'$set': admin_payload})
        else:
            self.db.users.insert_one({
                **admin_payload,
                'created_at': datetime.utcnow(),
            })
    
    # Authentication methods
    def create_user(self, email: str, password: str, full_name: str = None, gender: str = None, date_of_birth: str = None, weight: float = None, height: float = None, clinical_stage: str = None, role: str = 'patient', phone: str = None, hospital: str = None, specialties = None, doctor_identifier: str = None, age: int = None, doctor_gender: str = None, qualification: str = None, years_experience: int = None):
        """Create a new user"""
        try:
            role = (role or 'patient').strip().lower()
            if role not in ['patient', 'doctor', 'admin']:
                raise ValueError('Invalid role')

            approval_status = 'pending' if role == 'doctor' else 'approved'
            user_doc = {
                'email': email,
                'password_hash': generate_password_hash(password),
                'full_name': full_name,
                'role': role,
                'approval_status': approval_status,
                'phone': phone,
                'hospital': hospital,
                'specialties': self._normalize_specialties(specialties),
                'doctor_identifier': doctor_identifier,
                'age': age,
                'gender': doctor_gender if role == 'doctor' else gender,
            'qualification': qualification,
            'years_experience': years_experience,
            'availability_slots': [],
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }
            result = self.db.users.insert_one(user_doc)
            
            # Calculate BMI and Class
            bmi = None
            bmi_class = None
            try:
                if weight and height and float(height) > 0:
                    w = float(weight)
                    h = float(height) / 100.0
                    bmi = w / (h * h)
                    if bmi < 18.5:
                        bmi_class = "Underweight"
                    elif bmi < 25.0:
                        bmi_class = "Normal Weight"
                    elif bmi < 30.0:
                        bmi_class = "Overweight"
                    else:
                        bmi_class = "Obese"
            except Exception:
                pass

            # Calculate Age
            age = None
            if date_of_birth:
                try:
                    dob = datetime.strptime(date_of_birth, "%Y-%m-%d")
                    today = datetime.utcnow()
                    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                except Exception:
                    pass
            
            if role == 'patient':
                # Create patient profile
                profile_doc = {
                    'id': str(result.inserted_id),
                    'patient_id': str(result.inserted_id),
                    'full_name': full_name,
                    'gender': gender,
                    'date_of_birth': date_of_birth,
                    'age': age,
                    'weightKg': float(weight) if weight else None,
                    'heightCm': float(height) if height else None,
                    'stage': clinical_stage,
                    'bmi': bmi,
                    'bmiClass': bmi_class,
                    'created_at': datetime.utcnow(),
                    'updated_at': datetime.utcnow(),
                }
                self.db.patient_profiles.insert_one(profile_doc)

            created_user = self.db.users.find_one({'_id': result.inserted_id})
            return self._serialize_user(created_user)
        except DuplicateKeyError:
            raise ValueError('User with this email already exists')
    
    def authenticate_user(self, email: str, password: str):
        """Authenticate user and return user data"""
        user = self.db.users.find_one({'email': email})
        if not user:
            return None
        
        if not check_password_hash(user['password_hash'], password):
            return None

        return self._serialize_user(user)
    
    def generate_token(self, user_id: str, email: str):
        """Generate JWT token"""
        expires = datetime.utcnow() + timedelta(minutes=JWT_EXPIRATION_MINUTES)
        payload = {
            'user_id': user_id,
            'email': email,
            'exp': expires,
            'iat': datetime.utcnow(),
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        
    def revoke_token(self, token: str):
        """Add a token to the blocklist (for logout)"""
        self.revoked_tokens.add(token)
    
    def verify_token(self, token: str):
        """Verify JWT token and return user data"""
        if token in self.revoked_tokens:
            return None
            
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get('user_id')
            user = self.db.users.find_one({'_id': ObjectId(user_id)})
            if user:
                return self._serialize_user(user)
        except JWTError:
            pass
        return None

    def get_user_by_id(self, user_id: str):
        try:
            user = self.db.users.find_one({'_id': ObjectId(user_id)})
            return self._serialize_user(user)
        except Exception:
            return None

    def list_users(self, filters: dict = None):
        filters = filters or {}
        users = self.db.users.find(filters).sort('created_at', -1)
        return [self._serialize_user(user) for user in users]

    def update_user(self, user_id: str, updates: dict):
        payload = {**updates, 'updated_at': datetime.utcnow()}
        result = self.db.users.update_one({'_id': ObjectId(user_id)}, {'$set': payload})
        if result.matched_count == 0:
            return None
        return self.get_user_by_id(user_id)

    def list_approved_doctors(self):
        doctors = self.db.users.find({
            'role': 'doctor',
            'approval_status': 'approved',
        }).sort('created_at', -1)
        return [self._serialize_user(doctor) for doctor in doctors]

    def get_patient_profile_details(self, patient_id: str):
        profile = self.db.patient_profiles.find_one({'id': patient_id}) or self.db.patient_profiles.find_one({'patient_id': patient_id})
        return self._to_dict(profile)

    def get_latest_test_for_patient(self, patient_id: str, test_type: str = None):
        query = {'patient_id': patient_id}
        if test_type:
            query['test_type'] = test_type
        test = self.db.tests.find_one(query, sort=[('created_at', -1)])
        return self._to_dict(test)

    def list_tests_for_patient(self, patient_id: str, limit: int = None):
        query = self.db.tests.find({'patient_id': patient_id}).sort('created_at', -1)
        if limit:
            query = query.limit(limit)
        return [self._to_dict(doc) for doc in query]

    def get_report_by_id(self, report_id: str):
        try:
            report = self.db.reports.find_one({'_id': ObjectId(report_id)})
        except Exception:
            report = self.db.reports.find_one({'id': report_id})
        return self._to_dict(report)

    def find_report(self, filter_dict: dict):
        doc = self.db.reports.find_one(filter_dict)
        return self._to_dict(doc)

    def create_report(self, report_doc: dict):
        report_doc['created_at'] = datetime.utcnow()
        report_doc['updated_at'] = datetime.utcnow()
        result = self.db.reports.insert_one(report_doc)
        return self.get_report_by_id(str(result.inserted_id))

    def update_report(self, report_id: str, updates: dict):
        payload = {**updates, 'updated_at': datetime.utcnow()}
        result = self.db.reports.update_one({'_id': ObjectId(report_id)}, {'$set': payload})
        if result.matched_count == 0:
            return None
        return self.get_report_by_id(report_id)

    def list_reports(self, filter_dict: dict = None):
        query = self.db.reports.find(filter_dict or {}).sort('updated_at', -1)
        return [self._to_dict(doc) for doc in query]

    def create_appointment(self, appointment_doc: dict):
        object_id = ObjectId()
        appointment_doc['_id'] = object_id
        appointment_doc['id'] = str(object_id)
        appointment_doc['created_at'] = datetime.utcnow()
        appointment_doc['updated_at'] = datetime.utcnow()
        result = self.db.appointments.insert_one(appointment_doc)
        return self.get_appointment_by_id(str(result.inserted_id))

    def get_appointment_by_id(self, appointment_id: str):
        try:
            appointment = self.db.appointments.find_one({'_id': ObjectId(appointment_id)})
        except Exception:
            appointment = self.db.appointments.find_one({'id': appointment_id})
        if appointment is None:
            appointment = self.db.appointments.find_one({'id': appointment_id})
        return self._to_dict(appointment)

    def update_appointment(self, appointment_id: str, updates: dict):
        payload = {**updates, 'updated_at': datetime.utcnow()}
        try:
            result = self.db.appointments.update_one({'_id': ObjectId(appointment_id)}, {'$set': payload})
        except Exception:
            result = self.db.appointments.update_one({'id': appointment_id}, {'$set': payload})
        if result.matched_count == 0:
            result = self.db.appointments.update_one({'id': appointment_id}, {'$set': payload})
        if result.matched_count == 0:
            return None
        return self.get_appointment_by_id(appointment_id)

    def list_appointments(self, filter_dict: dict = None):
        query = self.db.appointments.find(filter_dict or {}).sort('appointment_date', 1)
        return [self._to_dict(doc) for doc in query]

    def create_chat_message(self, message_doc: dict):
        message_doc['created_at'] = datetime.utcnow()
        result = self.db.chat_messages.insert_one(message_doc)
        return self._to_dict(self.db.chat_messages.find_one({'_id': result.inserted_id}))

    def list_chat_messages(self, filter_dict: dict):
        query = self.db.chat_messages.find(filter_dict).sort('created_at', 1)
        return [self._to_dict(doc) for doc in query]
    
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

