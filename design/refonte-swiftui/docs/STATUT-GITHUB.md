# Statut de remise sur GitHub

La branche `design/swiftui-visual-system` existe et reste sur la base develop auditée `2c879899adc0e7c3b98817ef76cf026ea5d22bf8`. La tentative d’écriture via le connecteur a été bloquée ; aucun commit ni PR de cette livraison n’a été enregistré.

Le patch fourni ajoute exclusivement des fichiers sous `design/refonte-swiftui`. Il ne modifie aucune application ni configuration racine du monorepo. Il a été vérifié dans un dépôt local vide et les fichiers extraits ont été comparés octet par octet aux sources livrées. L’application sur votre copie actuelle du vrai dépôt exige encore `git apply --check` pour détecter une collision ou un changement concurrent.

Ne jamais utiliser `--force`, `reset --hard` ou un écrasement pour appliquer ce lot. Conserver les fichiers locaux modifiés, relire le HEAD actuel et créer un autre nom de branche si nécessaire. Les fichiers compilés et captures volumineuses restent dans l’archive de consultation, pas dans le patch de sources.
