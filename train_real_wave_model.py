import tensorflow as tf
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.applications import InceptionV3
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout, BatchNormalization
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
import os
import numpy as np
import pandas as pd
import glob

def train_real_wave_model():
    print("=== Training Wave Model with Real Data (InceptionV3) ===")
    
    base_dir = r"E:\Documents\Parkinsons\Proj\PDD_v3\backend\wave_datasets"
    folders = ['wave', 'wave_2']
    
    def get_files(split_names):
        files = []
        for f in folders:
            for split in split_names:
                search_path = os.path.join(base_dir, f, split, '*', '*.*')
                for path in glob.glob(search_path):
                    if os.path.isfile(path):
                        label = os.path.basename(os.path.dirname(path))
                        files.append({'filename': path, 'class': label})
        return pd.DataFrame(files)

    train_df = get_files(['training'])
    val_df = get_files(['validation'])
    test_df = get_files(['testing'])
    
    print(f"Dataset summary:")
    print(f"Training: {len(train_df)} images")
    print(f"Validation: {len(val_df)} images")
    print(f"Testing: {len(test_df)} images")
    
    classes = ['parkinson', 'healthy']
    
    # Removed 'shear_range'. Shearing distorts the natural tremor of the wave!
    train_datagen = ImageDataGenerator(
        rescale=1./255,
        rotation_range=10, 
        width_shift_range=0.1,
        height_shift_range=0.1,
        zoom_range=0.1,
        fill_mode='constant',
        cval=0
    )
    
    val_test_datagen = ImageDataGenerator(rescale=1./255)
    
    batch_size = 16
    # FIX 1: Native InceptionV3 resolution
    target_size = (299, 299) 
    
    train_generator = train_datagen.flow_from_dataframe(
        dataframe=train_df,
        x_col='filename',
        y_col='class',
        target_size=target_size,
        batch_size=batch_size,
        class_mode='binary',
        classes=classes
    )
    
    val_generator = val_test_datagen.flow_from_dataframe(
        dataframe=val_df,
        x_col='filename',
        y_col='class',
        target_size=target_size,
        batch_size=batch_size,
        class_mode='binary',
        classes=classes
    )
    
    test_generator = val_test_datagen.flow_from_dataframe(
        dataframe=test_df,
        x_col='filename',
        y_col='class',
        target_size=target_size,
        batch_size=batch_size,
        class_mode='binary',
        classes=classes,
        shuffle=False
    )
    
    base_model = InceptionV3(
        input_shape=(299, 299, 3),
        include_top=False,
        weights='imagenet'
    )
    
    # FIX 2: Safer fine-tuning. Let's unfreeze fewer layers initially (just the top block)
    for layer in base_model.layers[:-30]: 
        layer.trainable = False
        
    # FIX 3: Stripped down, highly efficient custom head
    x = base_model.output
    x = GlobalAveragePooling2D()(x)
    x = BatchNormalization()(x)
    x = Dropout(0.5)(x) # One strong dropout to prevent overfitting
    
    x = Dense(256, activation='relu')(x) # Removed excessive L2 and extra dense blocks
    x = BatchNormalization()(x)
    x = Dropout(0.3)(x)
    
    output = Dense(1, activation='sigmoid')(x)
    
    model = Model(inputs=base_model.input, outputs=output)
    
    # Lowered LR slightly because we are fine-tuning pre-trained layers immediately
    model.compile(
        optimizer=Adam(learning_rate=5e-5), 
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')]
    )
    
    # Ensure save directory exists so ModelCheckpoint doesn't crash
    save_dir = r'backend\models\wave'
    os.makedirs(save_dir, exist_ok=True)
    
    callbacks = [
        EarlyStopping(monitor='val_loss', patience=12, restore_best_weights=True, verbose=1),
        ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=1e-7, verbose=1),
        ModelCheckpoint(os.path.join(save_dir, 'inception_wave_v2.h5'), monitor='val_accuracy', save_best_only=True, verbose=1)
    ]
    
    print("\n=== Training Model ===")
    history = model.fit(
        train_generator,
        epochs=100,
        validation_data=val_generator,
        callbacks=callbacks,
        verbose=1
    )
    
    print("\n=== Comprehensive Evaluation on Test Set ===")
    model = tf.keras.models.load_model(os.path.join(save_dir, 'inception_wave_v2.h5'))
    results = model.evaluate(test_generator, verbose=1)
    print(f"Test Loss: {results[0]:.4f}")
    print(f"Test Accuracy: {results[1]:.4f}")
    print(f"Test AUC: {results[2]:.4f}")
    
    # Detailed Testing
    y_pred = model.predict(test_generator, verbose=1)
    y_pred_classes = (y_pred > 0.5).astype(int).flatten()
    y_true = test_generator.classes
    
    from sklearn.metrics import classification_report, confusion_matrix
    print("\nClassification Report (parkinson=0, healthy=1):")
    print(classification_report(y_true, y_pred_classes, target_names=['parkinson', 'healthy']))
    
    print("\nConfusion Matrix:")
    print(confusion_matrix(y_true, y_pred_classes))
    
    print("\n✓ Model trained and saved to backend/models/wave/inception_wave_v2.h5")

if __name__ == "__main__":
    tf.random.set_seed(42)
    np.random.seed(42)
    train_real_wave_model()
