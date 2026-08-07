# Practex Learning Engine

Entry point:
- LearningEngine.updateLearning(mcq,picked)

Pipeline:
1. Record attempt
2. Trim history (8)
3. Compute:
   - correctRate
   - wrongConsistency
   - lastTwoCorrect
4. Classify:
   - new
   - noconcept
   - misconception
   - learning
   - mastered
5. Compute due date
6. Persist library

Future phases should only call updateLearning(); no scheduling logic should be duplicated elsewhere.
