import os
import glob
import csv

DATASET_DIRS = [
    "dataset_audio/AAAA",
    "dataset_audio/ReadText",
    "dataset_audio/SpontaneousDialogue"
]

OUTPUT_CSV = "dataset_metadata.csv"

def extract_patient_id(filename, parent_folder):
    """
    Extracts a generalized and unique true_patient_id.
    Ensures that if the same human is in both ReadText and SpontaneousDialogue,
    they get the EXACT same ID so GroupKFold doesn't leak their audio across splits.
    """
    base_name = os.path.basename(filename).replace(".wav", "")
    
    # Handle SJTU Dataset (AAAA folder)
    if "AAAA" in parent_folder:
        parts = base_name.split("_")
        if len(parts) >= 2:
            return f"SJTU_{parts[0]}_{parts[1]}"
        return f"SJTU_{base_name}"
        
    # Handle MDVR-KCL Dataset (ReadText & SpontaneousDialogue folders)
    elif "ReadText" in parent_folder or "SpontaneousDialogue" in parent_folder:
        parts = base_name.split("_")
        if len(parts) >= 1:
            # Use the SAME prefix "MDVR" so the exact same human gets the exact same ID!
            return f"MDVR_{parts[0]}" 
        return f"MDVR_{base_name}"

    return f"UNKNOWN_{base_name}"

def main():
    print("Generating dataset metadata...")
    records = []
    
    classes = {'HC': 0, 'PD': 1, 'HC_AH': 0, 'PD_AH': 1} # Handling varying folder names for healthy/parkinsons
    
    for label_name, label_idx in classes.items():
        for dataset_dir in DATASET_DIRS:
            folder_path = os.path.join(dataset_dir, label_name)
            if not os.path.exists(folder_path):
                continue
                
            wav_files = glob.glob(os.path.join(folder_path, "*.wav"))
            for file_path in wav_files:
                # Use forward slash for consistent cross-platform paths inside CSV
                normalized_path = file_path.replace("\\", "/")
                
                true_patient_id = extract_patient_id(file_path, folder_path)
                
                # Assign simple string labels for readability, though idx is 0 or 1
                label_str = 'Healthy' if label_idx == 0 else 'Parkinsons'
                
                records.append({
                    "file_path": normalized_path,
                    "true_patient_id": true_patient_id,
                    "label_idx": label_idx,
                    "label_str": label_str,
                    "dataset_source": os.path.basename(dataset_dir)
                })

    if not records:
        print("Error: No audio files found in the specified directories.")
        return

    with open(OUTPUT_CSV, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["file_path", "true_patient_id", "label_idx", "label_str", "dataset_source"])
        writer.writeheader()
        writer.writerows(records)

    print(f"Successfully generated {OUTPUT_CSV} with {len(records)} entries.")
    
    # Validation step: Print number of unique patients
    unique_patients = set(r["true_patient_id"] for r in records)
    print(f"Total Unique Patients: {len(unique_patients)}")

if __name__ == "__main__":
    main()
