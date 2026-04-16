import os
import glob
import numpy as np
import tensorflow as tf
from tensorflow.keras.preprocessing import image as keras_image

def main():
    base_dir = r"E:\Documents\Parkinsons\Proj\PDD_v3\backend\wave_datasets"
    folders = ['wave', 'wave_2']
    
    # Collect files
    files = []
    counts = {'wave': {}, 'wave_2': {}}
    total_count = 0
    
    for f in folders:
        for split in ['training', 'testing', 'validation']:
            for cls in ['healthy', 'parkinson']:
                search_path = os.path.join(base_dir, f, split, cls, '*.*')
                paths = glob.glob(search_path)
                valid_paths = [p for p in paths if os.path.isfile(p)]
                count = len(valid_paths)
                
                if split not in counts[f]:
                    counts[f][split] = {}
                counts[f][split][cls] = count
                
                for p in valid_paths:
                    files.append((p, cls))
                    total_count += 1
                    
    print("\n" + "="*40)
    print("=== IMAGE COUNTS BY FOLDER & SPLIT ===")
    print("="*40)
    for f in folders:
        print(f"\nDataset: {f}")
        for split, split_counts in counts[f].items():
            h_count = split_counts.get('healthy', 0)
            p_count = split_counts.get('parkinson', 0)
            if h_count > 0 or p_count > 0:
                print(f"  - {split.capitalize()}: {h_count} healthy | {p_count} parkinson")
    print("-" * 40)
    print(f"Total Images Combined: {total_count}")
    print("="*40 + "\n")
    
    print("Loading specialized InceptionV3 wave model...")
    model_path = r"E:\Documents\Parkinsons\Proj\PDD_v3\backend\models\wave\inception_wave_v2.h5"
    model = tf.keras.models.load_model(model_path)
    
    print("\nStarting comprehensive evaluation on all images...")
    correct = 0
    processed = 0
    target_size = (299, 299)
    
    # Create confusion matrix tracking
    cm = {'healthy': {'healthy': 0, 'parkinson': 0}, 
          'parkinson': {'healthy': 0, 'parkinson': 0}}
    
    for path, true_cls in files:
        # Load exactly as we trained (rescale 1/255)
        img = keras_image.load_img(path, target_size=target_size)
        img_array = keras_image.img_to_array(img)
        img_array = img_array / 255.0
        img_array = np.expand_dims(img_array, axis=0)
        
        # Disable verbose to avoid spamming the console
        pred_prob = model.predict(img_array, verbose=0)[0][0]
        
        # Target classes in flow_from_dataframe were ['parkinson', 'healthy'] -> parkinson=0, healthy=1
        pred_cls = 'healthy' if pred_prob > 0.5 else 'parkinson'
        
        if pred_cls == true_cls:
            correct += 1
            
        cm[true_cls][pred_cls] += 1
        processed += 1
        
        # Status update
        if processed % 50 == 0:
            print(f"  Processed {processed}/{total_count} images...", flush=True)
            
    accuracy = correct / total_count
    
    print("\n" + "="*40)
    print("=== FINAL MODEL EVALUATION RESULTS ===")
    print("="*40)
    print(f"Overall Accuracy: {accuracy*100:.2f}% ({correct}/{total_count} images correct)\n")
    print("Detailed Confusion Matrix:")
    print(f"                Predicted Healthy   Predicted Parkinson")
    print(f"Actual Healthy   {cm['healthy']['healthy']:<19} {cm['healthy']['parkinson']}")
    print(f"Actual Parkinson {cm['parkinson']['healthy']:<19} {cm['parkinson']['parkinson']}")
    print("="*40)

if __name__ == "__main__":
    main()
